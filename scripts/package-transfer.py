"""Prepare a verified Mac development transfer ZIP from an audited public Git repository.

Does not publish, edit the input repository, copy to Desktop, install anything, or
run application tests. Git bundle creation writes only into this project's .local.
Usage: python scripts/package-transfer.py --source <public-git-directory> --commit <published-full-sha>
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MAX_BLOB = 128 * 1024 * 1024
MAX_ALL_BLOBS = 512 * 1024 * 1024
HEX = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})')


class TransferError(Exception):
    """Messages contain rule names or public relative paths, never Git stderr or matched secrets."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(source: Path, *arguments: str, input_bytes: bytes | None = None) -> bytes:
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    try:
        result = subprocess.run(['git', '-C', str(source), *arguments], input=input_bytes,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=environment, timeout=600, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise TransferError(f'Git operation failed: {arguments[0]} ({type(error).__name__})') from None
    if result.returncode:
        raise TransferError(f'Git operation failed: {arguments[0]} (exit {result.returncode})')
    return result.stdout


def load_policy():
    # Load the maintained audit policy beside this script, never execute code from --source.
    location = Path(__file__).with_name('audit-public-source.py')
    spec = importlib.util.spec_from_file_location('yuanda_public_source_policy', location)
    if spec is None or spec.loader is None:
        raise TransferError('Public source audit policy is unavailable')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    return policy


def safe_path(name: str, policy) -> None:
    if not policy.safe_relative(name):
        raise TransferError('Unsafe tracked pathname')
    parts = PurePosixPath(name).parts
    if any(part.casefold() in policy.FORBIDDEN_PARTS for part in parts):
        raise TransferError(f'Forbidden tracked path in Git history: {name}')
    if policy.SENSITIVE_NAMES.fullmatch(parts[-1]):
        raise TransferError(f'Sensitive tracked filename in Git history: {name}')
    if len(parts) == 1 and name not in policy.ROOT_FILES:
        raise TransferError(f'Unexpected tracked root file: {name}')
    if len(parts) > 1 and parts[0] not in policy.ROOT_DIRS:
        raise TransferError(f'Unexpected tracked root directory: {parts[0]}')
    if name not in policy.ROOT_FILES and name not in policy.BINARY_FIXTURES and PurePosixPath(name).suffix.lower() not in policy.TEXT_SUFFIXES:
        raise TransferError(f'Unapproved tracked file type: {name}')


def repository_url(source: Path) -> str:
    remote = git(source, 'remote', 'get-url', 'origin').decode('utf-8').strip()
    match = re.fullmatch(r'git@github\.com:([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?', remote)
    if match:
        owner, name = match.groups()
    else:
        url = urlsplit(remote)
        if (url.scheme != 'https' or url.hostname != 'github.com' or url.username or url.password
                or url.port or url.query or url.fragment):
            raise TransferError('origin must be a credential-free GitHub HTTPS or git@github.com URL')
        match = re.fullmatch(r'/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?', url.path)
        if not match:
            raise TransferError('origin is not a GitHub repository URL')
        owner, name = match.groups()
    if owner in {'.', '..'} or name in {'.', '..'}:
        raise TransferError('Invalid GitHub repository name')
    return f'https://github.com/{owner}/{name}'


def tree(source: Path, commit: str, policy) -> dict[str, tuple[str, str]]:
    entries = {}
    folded = {}
    for record in git(source, 'ls-tree', '-r', '-z', '--full-tree', commit).split(b'\0'):
        if not record:
            continue
        try:
            metadata, raw_name = record.split(b'\t', 1)
            mode, kind, oid = metadata.decode('ascii').split(' ')
            name = raw_name.decode('utf-8')
        except (ValueError, UnicodeError):
            raise TransferError('Invalid Git tree metadata') from None
        safe_path(name, policy)
        if mode not in {'100644', '100755'} or kind != 'blob' or not HEX.fullmatch(oid):
            raise TransferError(f'Symlinks, submodules and special Git entries are not transferable: {name}')
        key = unicodedata.normalize('NFC', name).casefold()
        if key in folded and folded[key] != name:
            raise TransferError('Tracked paths collide on a case-insensitive or Unicode-normalizing filesystem')
        folded[key] = name
        entries[name] = (mode, oid)
    return entries


def blobs(source: Path, identifiers: set[str]) -> dict[str, bytes]:
    ordered = sorted(identifiers)
    request = ''.join(oid + '\n' for oid in ordered).encode('ascii')
    sizes = git(source, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)', input_bytes=request)
    total = 0
    for expected, line in zip(ordered, sizes.decode('ascii').splitlines(), strict=True):
        actual, kind, length = line.split(' ')
        if actual != expected or kind != 'blob' or not length.isdecimal() or int(length) > MAX_BLOB:
            raise TransferError('Unexpected or oversized source blob')
        total += int(length)
    if total > MAX_ALL_BLOBS:
        raise TransferError('Git history exceeds the transfer source inspection size limit')
    stream = git(source, 'cat-file', '--batch', input_bytes=request)
    result, offset = {}, 0
    for expected in ordered:
        end = stream.index(b'\n', offset)
        actual, kind, length = stream[offset:end].decode('ascii').split(' ')
        length = int(length)
        if actual != expected or kind != 'blob':
            raise TransferError('Git blob stream does not match requested objects')
        start = end + 1
        content = stream[start:start + length]
        if len(content) != length or stream[start + length:start + length + 1] != b'\n':
            raise TransferError('Git blob stream was truncated')
        algorithm = hashlib.sha1 if len(expected) == 40 else hashlib.sha256
        if algorithm(f'blob {length}\0'.encode('ascii') + content).hexdigest() != expected:
            raise TransferError('Git source blob integrity mismatch')
        result[expected] = content
        offset = start + length + 1
    if offset != len(stream):
        raise TransferError('Git blob stream contains unexpected trailing data')
    return result


def transfer_text(version: str, url: str, commit: str) -> str:
    return f'''# 原搭 {version}：在自己的 Mac 上继续开发

公开仓库：[{url}]({url})

本包对应提交：[`{commit}`]({url}/commit/{commit})。源码、离线历史和清单对应这次打包时核对的仓库状态。

## 文件是什么

- `source/`：该提交的已跟踪源码快照，不含 `.git`、账号配置、缓存、依赖和逆向资料。
- `yuanda-history.bundle`：Git 离线历史；不包含 `.git/config`、hooks 或凭据文件。它不能替代你的 GitHub 登录。
- `TRANSFER-MANIFEST.json`：源码、交接说明与 bundle 的大小和 SHA-256 校验清单。
- 个人工程、旧电脑的连接令牌、商业软件、EXE 和 Node/Electron 依赖没有随包迁移。

## 第一步：解压

**窗口：Mac 的 Finder（访达）。**双击 ZIP 解压到自己可写的开发目录。保留整个文件夹。

**窗口：终端（Terminal）。**输入 `cd` 和一个空格，把刚解压、包含本说明的文件夹拖进终端，按回车。先检查：

```sh
git --version
node --version
```

需要 Git 和带 npm 的 Node.js **22.12.0 或更新版本**。Apple 芯片使用 arm64 Node，Intel Mac 使用 x64 Node。项目脚本不安装全局 Skill/MCP，不修改用户级客户端配置。

## 第二步：恢复可继续提交的 Git 仓库

仍在**终端**，依次执行：

```sh
git clone yuanda-history.bundle yuanda
cd yuanda
git switch -c mac-development {commit}
git remote set-url origin {url}.git
git rev-parse HEAD
```

最后一条应显示上面的完整提交号。克隆 bundle 本身不需要联网；之后安装依赖、访问 GitHub 或推送仍需网络及新电脑自己的登录。

如果暂时没有 Git，也可直接进入 `source` 文件夹运行下一步；它是可运行源码快照，但没有 Git 历史。不要把此快照覆盖到已经克隆的仓库里。

## 第三步：安装和打开

在**终端**的 `yuanda` 仓库根目录（或备用的 `source` 目录）执行：

```sh
node scripts/setup.mjs
node scripts/start-desktop.mjs
```

安装成功后会显示安装完成，启动后应出现**原搭桌面窗口**。Windows 的 `node_modules` 和 EXE 不能直接拿来当 Mac 版本使用。

自动检查和本机打包入口：

```sh
node scripts/test-all.mjs
node scripts/build-desktop.mjs
```

打包后，在**Finder**打开 `dist/原搭-{version}/`，尝试打开其中的 `原搭.app`。请保留旁边的 `projects`、`exports`、`data` 和说明文件。当前是可写目录内的开发便携方案，不应单独把 `.app` 移到 `/Applications`。

## 已验证和未验证的界限

Windows 的发布验证及功能范围见 [发布说明](source/docs/RELEASE_NOTES.md)、[能力清单](source/docs/FEATURE_MATRIX.md)。本迁移打包只核对 Git、文件清单、bundle、ZIP CRC 和哈希；不会重新运行 Windows 功能测试。

**Mac 尚未真机验收。**源码含 Mac 路径与本机开发包方案，但启动、输入法、菜单、剪贴板、Agent、导出、打包和签名仍需在你的 Mac 验证。临时签名不等于 Developer ID 签名或 Apple 公证。详见 [Mac 开发指南](source/docs/MAC_DEVELOPMENT.md)。不要把“源码可移交”理解为“Mac 正式发行版已完成”。

## 接着做什么

开发者或 Agent 先读 [继续开发说明](source/docs/CONTINUE_DEVELOPMENT.md)，再看 [路线图](source/docs/ROADMAP.md) 和能力清单中未完成的子项。长期目标仍是尽可能覆盖 Axure 核心功能；公开当前预览版不表示全部目标完成。

在新电脑打开原搭后，从该窗口复制新的 Agent 连接配置，放入当前项目配置。不要复用旧电脑的绝对路径、连接文件或临时令牌。编辑项目用 `.yuanda` 保留完整信息；有限 RP 导出不能替代完整工程保存。

如果某一步失败，保留终端完整报错、当前系统/芯片及这份提交号，再继续排查；不要先删除源码或个人工程。
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path, help='Audited, clean public Git repository')
    parser.add_argument('--commit', required=True, help='Full SHA of the actual published commit')
    args = parser.parse_args()
    if not HEX.fullmatch(args.commit):
        raise TransferError('--commit must be a full lowercase 40- or 64-character commit SHA')
    source = args.source.resolve(strict=True)
    if Path(git(source, 'rev-parse', '--show-toplevel').decode('utf-8').strip()).resolve() != source:
        raise TransferError('--source must be the repository root')
    if git(source, 'status', '--porcelain=v1', '--untracked-files=no'):
        raise TransferError('Tracked source/index changes exist; transfer requires the published clean commit')
    commit = git(source, 'rev-parse', '--verify', args.commit + '^{commit}').decode('ascii').strip()
    if git(source, 'rev-parse', 'HEAD').decode('ascii').strip() != commit:
        raise TransferError('Published commit does not match source HEAD')
    url, policy = repository_url(source), load_policy()
    refs_before = git(source, 'for-each-ref', '--format=%(objectname) %(refname)')
    for reference in refs_before.decode('utf-8').splitlines():
        _, name = reference.split(' ', 1)
        if name == 'refs/stash':
            raise TransferError('An audited public transfer repository must not contain stash history')
        git(source, 'rev-parse', '--verify', name + '^{commit}')
    tracked = {name.decode('utf-8') for name in git(source, 'ls-files', '-z').split(b'\0') if name}
    current_tree = tree(source, commit, policy)
    if tracked != current_tree.keys():
        raise TransferError('git ls-files differs from the published commit tree')
    history = git(source, 'rev-list', '--all', 'HEAD').decode('ascii').splitlines()
    if len(history) > 10000:
        raise TransferError('History is too large for this project transfer guard')
    all_files = {}
    for revision in history:
        for name, (_, oid) in tree(source, revision, policy).items():
            all_files.setdefault(oid, set()).add(name)
    contents = blobs(source, set(all_files))
    credential_rules = {key: rule for key, rule in policy.RULES.items() if key.startswith('credential-') or key == 'private-key-header'}
    for oid, names in all_files.items():
        if all(name in policy.BINARY_FIXTURES for name in names):
            continue
        try:
            text = contents[oid].decode('utf-8')
        except UnicodeError:
            raise TransferError('Non-text blob outside approved binary fixtures in Git history') from None
        if any(rule.search(text) for rule in credential_rules.values()):
            raise TransferError('Potential credential found in Git history; no transfer package created')
    package = json.loads(contents[current_tree['package.json'][1]])
    version = package['version']
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*', version):
        raise TransferError('Unsafe or missing project version')
    release_dir = ROOT / 'releases'
    release_dir.mkdir(parents=True, exist_ok=True)
    stem = f'原搭-{version}-Mac续开发.zip'
    target, sha_path, report_path = release_dir / stem, release_dir / (stem + '.sha256'), release_dir / (stem + '.audit.json')
    if any(file.exists() for file in (target, sha_path, report_path)):
        raise TransferError('Transfer ZIP or sidecar already exists; refusing to overwrite')
    temporary_parent = ROOT / '.local' / 'transfer-packaging'
    temporary_parent.mkdir(parents=True, exist_ok=True)
    # Keep the staging files and verification evidence for diagnosis; no recursive deletion.
    temporary = Path(tempfile.mkdtemp(prefix='run-', dir=temporary_parent))
    snapshot = temporary / 'source'
    source_entries = []
    for name, (mode, oid) in sorted(current_tree.items()):
        content = contents[oid]
        destination = snapshot / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        source_entries.append({'path': 'source/' + name, 'bytes': len(content), 'sha256': digest(content), 'gitBlob': oid, 'mode': mode})
    audit = policy.audit(snapshot)
    (temporary / 'source-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    if not audit['ok']:
        raise TransferError('Committed source failed the public source audit; inspect .local/transfer-packaging evidence')
    bundle = temporary / 'yuanda-history.bundle'
    git(source, 'bundle', 'create', str(bundle), '--all')
    git(source, 'bundle', 'verify', str(bundle))
    bundle_heads = git(source, 'bundle', 'list-heads', str(bundle)).decode('utf-8').splitlines()
    if not any(line.split(' ', 1)[0] == commit for line in bundle_heads):
        raise TransferError('Published commit is not advertised by the offline bundle')
    # --all must produce a self-contained bundle, with no prerequisite commit lines.
    with bundle.open('rb') as stream:
        signature = stream.readline()
        if signature not in {b'# v2 git bundle\n', b'# v3 git bundle\n'}:
            raise TransferError('Unrecognized Git bundle format')
        for line in stream:
            if line == b'\n':
                break
            if line.startswith(b'-'):
                raise TransferError('Offline transfer bundle unexpectedly requires another repository')
    bundle_bytes = bundle.read_bytes()
    note = transfer_text(version, url, commit).encode('utf-8')
    extras = {'TRANSFER.md': note, 'yuanda-history.bundle': bundle_bytes}
    entries = source_entries + [{'path': name, 'bytes': len(value), 'sha256': digest(value)} for name, value in extras.items()]
    manifest = {'version': version, 'repository': url, 'commit': commit,
                'createdAt': datetime.now(timezone.utc).isoformat(), 'sourceSelection': 'git ls-files, identical to committed tree',
                'historyCommitsInspected': len(history), 'bundleSelfContained': True, 'files': entries,
                'validationBoundary': {'sourceAndBundleVerified': True, 'macNativeTested': False,
                                       'applicationTestsRerunByPackager': False, 'remotePublicationMustBeVerifiedByCaller': True}}
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
    staged_zip = temporary / stem
    with zipfile.ZipFile(staged_zip, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for entry in source_entries:
            info = zipfile.ZipInfo(entry['path'])
            info.create_system = 3
            info.external_attr = int(entry['mode'], 8) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, contents[entry['gitBlob']])
        for name, content in extras.items():
            archive.writestr(name, content)
        archive.writestr('TRANSFER-MANIFEST.json', manifest_bytes)
    with zipfile.ZipFile(staged_zip) as archive:
        if archive.testzip() is not None:
            raise TransferError('ZIP CRC validation failed')
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != {item['path'] for item in entries} | {'TRANSFER-MANIFEST.json'}:
            raise TransferError('ZIP inventory does not match the transfer manifest')
        if archive.read('TRANSFER-MANIFEST.json') != manifest_bytes:
            raise TransferError('ZIP manifest content mismatch')
        for entry in entries:
            content = archive.read(entry['path'])
            if len(content) != entry['bytes'] or digest(content) != entry['sha256']:
                raise TransferError('ZIP file hash or size does not match the transfer manifest')
            if 'gitBlob' in entry and content != contents[entry['gitBlob']]:
                raise TransferError('ZIP source bytes differ from the published Git blob')
    if (git(source, 'rev-parse', 'HEAD').decode('ascii').strip() != commit
            or git(source, 'for-each-ref', '--format=%(objectname) %(refname)') != refs_before
            or git(source, 'status', '--porcelain=v1', '--untracked-files=no')):
        raise TransferError('Input repository changed while creating the transfer package')
    zip_sha = digest(staged_zip.read_bytes())
    # Exclusive creation preserves every existing delivery; only this project's releases is written.
    with target.open('xb') as destination, staged_zip.open('rb') as incoming:
        shutil.copyfileobj(incoming, destination)
    if digest(target.read_bytes()) != zip_sha:
        raise TransferError('Final transfer ZIP differs from its verified staging file')
    with sha_path.open('x', encoding='utf-8') as handle:
        handle.write(f'{zip_sha}  {stem}\n')
    report = {'ok': True, 'version': version, 'repository': url, 'commit': commit,
              'zip': stem, 'bytes': target.stat().st_size, 'sha256': zip_sha, 'crcVerified': True,
              'manifestVerified': True, 'sourceFiles': len(source_entries), 'historyCommitsInspected': len(history),
              'bundleVerified': True, 'bundleSelfContained': True, 'bundleSha256': digest(bundle_bytes),
              'sourceAuditPassed': True, 'inputTrackedFilesAndRefsUnchanged': True, 'macNativeTested': False,
              'remotePublicationMustBeVerifiedByCaller': True,
              'limitations': ['Credential scanning is heuristic; the input repository must already be publication-audited.',
                              'Approved binary fixtures are verified by hash, not examined for hidden data.',
                              'This package does not perform desktop acceptance or verify GitHub visibility.']}
    with report_path.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'ok': True, 'zip': str(target), 'sha256': zip_sha, 'report': str(report_path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (TransferError, OSError, ValueError, KeyError) as error:
        # Avoid printing Git stderr, remote credentials, input file contents, or filesystem exception paths.
        print(f'打包未完成：{error if isinstance(error, TransferError) else type(error).__name__}', file=sys.stderr)
        sys.exit(1)
