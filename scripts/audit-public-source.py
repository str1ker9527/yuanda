"""Audit a fresh package-source.py --stage directory before Git initialization.

Only paths, line numbers and fixed rule names are reported, never matched content.
This is a publication guard, not a complete secret detector or license opinion.
Usage: python scripts/audit-public-source.py <stage-directory>
The timestamped report is written under this checkout's .local/public-release/.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import unquote

SOURCE_ROOT = Path(__file__).resolve().parents[1]
GENERATED_IGNORE = (
    'node_modules/\n.local/\ndist/\nreleases/\nresearch/\ntools/\n'
    '.agents/\n.codex/\n*.log\n.DS_Store\ndata/\n'
).encode('utf-8')
REQUIRED = {
    'README.md', 'LICENSE', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes',
    'SOURCE-MANIFEST.json', 'docs/PROJECT_OVERVIEW.md', 'docs/CONTRIBUTING.md',
    'docs/SECURITY.md', 'docs/ARCHITECTURE.md', 'docs/ROADMAP.md',
    'docs/FEATURE_MATRIX.md', 'docs/CONTINUE_DEVELOPMENT.md',
    'docs/MAC_DEVELOPMENT.md', 'docs/RELEASE_NOTES.md',
    'docs/试玩指南.md', 'docs/Agent接入.md', 'docs/文件说明.md', 'docs/开发接口约定.md',
    'app/main.mjs', 'app/preload.cjs', 'app/platform-paths.mjs',
    'app/core/document.mjs', 'app/core/html-export.mjs', 'app/core/html-runtime.mjs',
    'app/core/rp-export.mjs', 'app/agent-mcp.mjs', 'app/agent-server.mjs',
    'app/agent-schema.mjs', 'scripts/setup.mjs', 'scripts/start-desktop.mjs',
    'scripts/platform-runtime.mjs', 'scripts/build-desktop.mjs',
    'scripts/test-all.mjs', 'scripts/test-desktop.mjs', 'scripts/smoke-desktop.mjs',
    'scripts/test-agent-mcp-desktop.mjs', 'scripts/verify-release.mjs',
    'scripts/package-source.py', 'scripts/audit-public-source.py',
    'scripts/yuanda-agent.mjs', 'scripts/yuanda-mcp.mjs',
    '.github/workflows/verify.yml', '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/feature_request.md', '.github/pull_request_template.md',
}
ROOT_FILES = {'README.md', 'LICENSE', 'package.json', 'package-lock.json',
              '.gitignore', '.gitattributes', 'SOURCE-MANIFEST.json'}
ROOT_DIRS = {'app', 'scripts', 'tests', 'docs', 'samples', 'exports', '.github'}
FORBIDDEN_PARTS = {
    '.git', '.local', '.agents', '.codex', '.aws', '.ssh', '.azure', '.kube',
    'node_modules', 'research', 'tools', 'data', 'dist', 'releases',
    '__pycache__', 'logs', 'cache', 'credentials',
}
TEXT_SUFFIXES = {'.md', '.json', '.js', '.mjs', '.cjs', '.css', '.html',
                 '.yml', '.yaml', '.csv', '.py', '.yuanda', '.yuandalib'}
# Binary fixtures are allowed only by their exact project-owned sample path.
BINARY_FIXTURES = {
    'samples/rp-batch-20261015/四色测试图.png',
    'samples/rp-agent-demo-20261015-v2/原搭-图片与跳转演示.rp',
}
SENSITIVE_NAMES = re.compile(
    r'(?i)^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.ds_store|'
    r'connection(?:[-_].*)?\.json|recovery.*\.json|credentials(?:\..*)?|'
    r'id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|pfx|p12|keystore|'
    r'db|sqlite|sqlite3|log|bak|exe|dll|pdb|dylib|so|zip|7z|tar|gz))$'
)
RULES = {
    'absolute-windows-path': re.compile(r'(?i)(?<![\w])[a-z]:[\\/]'),
    'personal-home-path': re.compile(r'(?:/(?:Users|home)/[^\s/]+|[A-Za-z]:[\\]+Users[\\]+[^\s\\]+)'),
    'work-chat-cache-path': re.compile(r'(?i)(?:WXWork|企业微信自动保存)[\\/]'),
    'credential-prefix': re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})'),
    'private-key-header': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'credential-literal': re.compile(r'''(?ix)(?:["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)["']?)\s*[:=]\s*["'][A-Za-z0-9_+/.=-]{24,}["']'''),
    'credential-url': re.compile(r'https?://[^\s/@:]+:[^\s/@]+@'),
}
# These are deliberate invalid-path/platform fixtures and the packager's public
# placeholder conversion, NOT directory-wide skips.
# Each exception requires this file, one-based line and the complete line hash.
# Credential rules are never exempted by this table. Editing a fixture requires
# review and an explicit exception update; moving it causes a fail-closed finding.
PATH_FIXTURE_EXCEPTIONS = {
    ('tests/agent-files.test.mjs', 9): 'f8f2c1d9be6bf45ec1bdf7dc6f141ea75e1535d3ed39a59c36a94f46e08e788a',
    ('tests/agent-mcp.test.mjs', 162): '3626b6cd3cc166522ad27df96d51e8b649c3e2a48e5e7b9b2da154adf3eee81e',
    ('tests/platform-paths.test.mjs', 11): 'b3fa46e743b5d4addaacabd8c5df7b92c0d786c9f5087f522215b4af60a59865',
    ('tests/platform-paths.test.mjs', 16): '2b83d972d7ee36ee2f06270cfaf81b589a604b6238434f14fa9924176d5fc3d4',
    ('scripts/package-source.py', 78): '08661217c1831e099b3b3e0b18fba23021b3f5fdc5e9dbef8de659ea108a0e2f',
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_relative(name: object) -> bool:
    if not isinstance(name, str) or not name or '\\' in name or ':' in name:
        return False
    if name.startswith('/') or any(ord(c) < 32 for c in name):
        return False
    parts = name.split('/')
    return all(p not in ('', '.', '..') for p in parts) and str(PurePosixPath(name)) == name


def linked(p: Path) -> bool:
    info = p.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & 0x400)


def audit(stage_input: Path) -> dict:
    findings, exceptions = [], []

    def flag(file: str, rule: str, line: int | None = None):
        item = {'file': file, 'rule': rule}
        if line is not None:
            item['line'] = line
        if item not in findings:
            findings.append(item)

    if not stage_input.exists() or not stage_input.is_dir():
        return {'ok': False, 'findings': [{'file': '.', 'rule': 'stage-directory-required'}]}
    if linked(stage_input):
        return {'ok': False, 'findings': [{'file': '.', 'rule': 'linked-stage-root'}]}
    stage = stage_input.resolve()
    files = {}
    pending = [stage]
    # Do not follow symlinks, junctions, reparse points or special files.
    while pending:
        directory = pending.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda p: p.name)
        except OSError:
            flag(directory.relative_to(stage).as_posix(), 'directory-unreadable')
            continue
        for entry in entries:
            relative = entry.relative_to(stage).as_posix()
            try:
                if linked(entry):
                    flag(relative, 'link-or-reparse-point-forbidden')
                    continue
                if not entry.resolve().is_relative_to(stage):
                    flag(relative, 'path-escape')
                    continue
                parts = entry.relative_to(stage).parts
                if any(part.casefold() in FORBIDDEN_PARTS for part in parts):
                    flag(relative, 'forbidden-path')
                    continue
                if not safe_relative(relative):
                    flag(relative, 'unsafe-path')
                    continue
                if entry.is_dir():
                    if len(parts) == 1 and parts[0] not in ROOT_DIRS:
                        flag(relative, 'unexpected-root-directory')
                        continue
                    pending.append(entry)
                elif entry.is_file():
                    if len(parts) == 1 and relative not in ROOT_FILES:
                        flag(relative, 'unexpected-root-file')
                    if SENSITIVE_NAMES.fullmatch(entry.name):
                        flag(relative, 'sensitive-file-name-or-type')
                    if relative not in ROOT_FILES and relative not in BINARY_FIXTURES and entry.suffix.lower() not in TEXT_SUFFIXES:
                        flag(relative, 'unapproved-file-type')
                    if entry.stat().st_size > 128 * 1024 * 1024:
                        flag(relative, 'source-file-too-large')
                        continue
                    files[relative] = entry.read_bytes()
                else:
                    flag(relative, 'special-file-forbidden')
            except OSError:
                flag(relative, 'file-unreadable')

    for required in sorted(REQUIRED - files.keys()):
        flag(required, 'required-file-missing')
    folded = {}
    for name in files:
        previous = folded.setdefault(name.casefold(), name)
        if previous != name:
            flag(name, 'case-insensitive-path-collision')
    manifest = None
    try:
        manifest = json.loads(files.get('SOURCE-MANIFEST.json', b''))
    except (ValueError, UnicodeError):
        flag('SOURCE-MANIFEST.json', 'invalid-manifest-json')
    listed = set()
    if not isinstance(manifest, dict) or not isinstance(manifest.get('files'), list):
        flag('SOURCE-MANIFEST.json', 'invalid-manifest-shape')
    else:
        for entry in manifest['files']:
            if not isinstance(entry, dict) or set(entry) != {'path', 'bytes', 'sha256'} or not safe_relative(entry.get('path')):
                flag('SOURCE-MANIFEST.json', 'invalid-manifest-entry')
                continue
            name = entry['path']
            if name in listed:
                flag(name, 'duplicate-manifest-entry')
            listed.add(name)
            if name == 'SOURCE-MANIFEST.json':
                flag(name, 'manifest-self-reference')
            if type(entry['bytes']) is not int or entry['bytes'] < 0 or not isinstance(entry['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256']):
                flag(name, 'invalid-manifest-metadata')
            if name not in files:
                flag(name, 'manifest-file-missing')
                continue
            content = files[name]
            if entry['bytes'] != len(content):
                flag(name, 'manifest-size-mismatch')
            if entry['sha256'] != digest(content):
                flag(name, 'manifest-sha256-mismatch')
        expected = listed | {'SOURCE-MANIFEST.json', '.gitignore'}
        for name in sorted(files.keys() - expected):
            flag(name, 'file-not-in-manifest')
        # The current packager emits .gitignore outside the hash list. Verify its
        # exact bytes instead of allowing arbitrary unmanifested contents.
        if '.gitignore' not in listed and files.get('.gitignore') != GENERATED_IGNORE:
            flag('.gitignore', 'unmanifested-gitignore-content-mismatch')

    version = None
    try:
        package = json.loads(files.get('package.json', b''))
        lock = json.loads(files.get('package-lock.json', b''))
        version = package['version']
        if not isinstance(version, str) or not re.fullmatch(r'[0-9A-Za-z.+-]{1,80}', version):
            flag('package.json', 'invalid-version')
            version = None
        if lock.get('version') != version or lock.get('packages', {}).get('', {}).get('version') != version:
            flag('package-lock.json', 'package-version-mismatch')
        if not isinstance(manifest, dict) or manifest.get('version') != version:
            flag('SOURCE-MANIFEST.json', 'package-version-mismatch')
        if package.get('license') != 'MIT':
            flag('package.json', 'unexpected-project-license')
    except (ValueError, UnicodeError, KeyError, TypeError, AttributeError):
        flag('package.json', 'invalid-package-or-lock')
    if not files.get('LICENSE', b'').startswith(b'MIT License'):
        flag('LICENSE', 'mit-license-text-missing')

    source_path_markers = {str(SOURCE_ROOT), SOURCE_ROOT.as_posix()}
    text_files, markdown_links = 0, 0
    for name, content in files.items():
        if name in BINARY_FIXTURES:
            continue
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            flag(name, 'non-utf8-source')
            continue
        text_files += 1
        for no, line in enumerate(text.splitlines(), 1):
            for rule, pattern in RULES.items():
                if not pattern.search(line):
                    continue
                if rule in {'absolute-windows-path', 'personal-home-path'} and PATH_FIXTURE_EXCEPTIONS.get((name, no)) == digest(line.encode('utf-8')):
                    exceptions.append({'file': name, 'line': no, 'rule': rule, 'reason': 'exact-reviewed-portable-placeholder' if name == 'scripts/package-source.py' else 'exact-reviewed-invalid-path-or-platform-fixture'})
                else:
                    flag(name, rule, no)
            if any(marker in line for marker in source_path_markers):
                flag(name, 'current-checkout-path', no)
        if not name.endswith('.md'):
            continue
        fence = None
        for no, line in enumerate(text.splitlines(), 1):
            marker = re.match(r'^\s*(`{3,}|~{3,})', line)
            if marker:
                char = marker[1][0]
                fence = None if fence == char else (char if fence is None else fence)
                continue
            if fence:
                continue
            targets = re.findall(r'\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\n]+?)\s*\)', line)
            reference = re.match(r'^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)', line)
            if reference:
                targets.append(reference[1])
            for target in targets:
                if target.startswith('<') and '>' in target:
                    target = target[1:target.index('>')]
                else:
                    target = re.sub(r'''\s+["'][^"']*["']\s*$''', '', target)
                target = unquote(target.strip())
                if target.startswith(('#', '//')) or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', target):
                    continue
                target = re.split(r'[?#]', target, maxsplit=1)[0]
                target = re.sub(r':\d+(?::\d+|[-–]\d+)?$', '', target)
                if not target:
                    continue
                markdown_links += 1
                path = (stage / name).parent / target
                try:
                    if not path.resolve().is_relative_to(stage):
                        flag(name, 'markdown-link-outside-stage', no)
                    elif not path.exists():
                        flag(name, 'markdown-relative-link-missing', no)
                except (OSError, ValueError):
                    flag(name, 'markdown-link-invalid', no)
    return {
        'ok': not findings, 'version': version, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'auditorSha256': digest(Path(__file__).read_bytes()),
        'scope': 'fresh-public-stage-before-git-init', 'files': len(files),
        'manifestEntries': len(listed), 'textFiles': text_files, 'markdownLinks': markdown_links,
        'manifestSha256': digest(files['SOURCE-MANIFEST.json']) if 'SOURCE-MANIFEST.json' in files else None,
        'findings': findings, 'reviewedExceptions': exceptions,
        'limitations': ['Heuristic text scanning is not exhaustive secret detection.',
                       'Binary fixtures are checked by path and manifest hash, not for hidden data.',
                       'This checks publication contents, not functional or macOS acceptance.'],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', type=Path, help='Fresh generated source stage; must not contain Git metadata.')
    args = parser.parse_args()
    try:
        result = audit(args.stage)
    except (OSError, ValueError) as error:
        # Do not print exception text; filesystem messages can contain secrets.
        result = {'ok': False, 'findings': [{'file': '.', 'rule': 'audit-read-failed', 'errorType': type(error).__name__}]}
    output_dir = SOURCE_ROOT / '.local' / 'public-release'
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = output_dir / f'stage-audit-{stamp}.json'
    with output.open('x', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'ok': result['ok'], 'files': result.get('files', 0),
                      'report': output.relative_to(SOURCE_ROOT).as_posix(),
                      'findings': result['findings'],
                      'reviewedExceptions': result.get('reviewedExceptions', [])}, ensure_ascii=True, indent=2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
