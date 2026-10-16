"""Create a reviewable source ZIP from an explicit allowlist; never include research binaries or tokens."""
from pathlib import Path
import json
import zipfile
import hashlib
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--stage', type=Path, help='Create a new clean public source directory instead of a ZIP (refuses overwrite).')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
target = root / 'releases' / f'原搭-{version}-source.zip'
if not args.stage and target.exists():
    raise SystemExit(f'为保留已有产物，停止覆盖：{target}')
files = ['README.md', 'LICENSE', '.gitattributes', 'package.json', 'package-lock.json',
         'docs/试玩指南.md', 'docs/Agent接入.md', 'docs/文件说明.md', 'docs/开发接口约定.md',
         'scripts/setup.mjs', 'scripts/build-desktop.mjs', 'scripts/test-desktop.mjs',
         'scripts/smoke-desktop.mjs', 'scripts/yuanda-agent.mjs', 'scripts/package-source.py',
         'scripts/test-ui-regression.mjs', 'scripts/ui-regression.mjs',
         'scripts/run-advanced-ui-regression.mjs', 'scripts/advanced-ui-regression.mjs',
         'scripts/test-navigation-ui.mjs', 'scripts/test-page-folders-ui.mjs', 'scripts/generate-page-folders-demo.mjs', 'samples/yuanda/页面目录体验.yuanda', 'exports/页面目录体验.html', 'scripts/test-vector-ui.mjs',
         'scripts/test-form-ui.mjs', 'scripts/test-edit-safety-ui.mjs', 'scripts/test-close-regression.mjs', 'scripts/test-all.mjs',
         'scripts/test-repeater-ui.mjs', 'scripts/test-hierarchy-ui.mjs', 'scripts/test-complex-project-integration.mjs',
         'scripts/generate-structure-demo.mjs', 'scripts/test-structure-demo.mjs',
         'scripts/test-panel-ui.mjs', 'scripts/test-panel-boundaries.mjs', 'scripts/generate-panel-demo.mjs', 'scripts/test-panel-demo.mjs',
         'scripts/test-library-ui.mjs', 'scripts/test-library-desktop.mjs', 'scripts/generate-library-demo.mjs',
         'scripts/test-view-editor.mjs', 'scripts/test-adaptive-runtime.mjs', 'scripts/generate-view-demo.mjs', 'scripts/test-view-demo.mjs',
         'scripts/test-export-regression.mjs', 'scripts/export-regression.mjs',
         'scripts/generate-demo.mjs', 'scripts/verify-release.mjs',
         'samples/yuanda/原搭体验-0.2.yuanda', 'exports/原搭体验-0.2.html',
         'samples/yuanda/层级与分页体验.yuanda', 'samples/yuanda/任务导入示例.csv', 'exports/层级与分页体验.html',
         'samples/libraries/交互卡片.yuandalib', 'samples/yuanda/元件库体验.yuanda',
         'samples/yuanda/面板交互体验.yuanda', 'exports/面板交互体验.html']
files += ['samples/yuanda/自适应与母版体验.yuanda', 'exports/自适应与母版体验.html']
files += ['scripts/clipboard-marker-mock.mjs', 'scripts/test-image-input-desktop.mjs',
          'scripts/test-image-editor.mjs', 'scripts/test-image-runtime.mjs',
          'scripts/generate-image-demo.mjs', 'scripts/test-image-demo.mjs',
          'samples/yuanda/图片编辑体验.yuanda', 'exports/图片编辑体验.html']
files += ['scripts/test-style-editor.mjs', 'scripts/test-style-runtime.mjs',
          'scripts/generate-style-demo.mjs', 'scripts/test-style-demo.mjs',
          'samples/yuanda/样式与排版体验.yuanda', 'exports/样式与排版体验.html']
files += ['scripts/test-style-inheritance-editor.mjs', 'scripts/test-style-inheritance-runtime.mjs',
          'scripts/generate-style-inheritance-demo.mjs', 'scripts/test-style-inheritance-demo.mjs',
          'samples/yuanda/共享样式与格式刷体验.yuanda', 'exports/共享样式与格式刷体验.html']
files += ['scripts/yuanda-mcp.mjs', 'scripts/test-agent-mcp-desktop.mjs',
          'scripts/inspect-generated-rp.mjs', 'scripts/generate-rp-agent-demo.mjs',
          'samples/rp-batch-20261015/四色测试图.png',
          'samples/rp-agent-demo-20261015-v2/原搭-图片与跳转演示.yuanda',
          'samples/rp-agent-demo-20261015-v2/原搭-图片与跳转演示.rp']
files += ['scripts/test-editor-shell.mjs', 'scripts/test-drag-preview.mjs', 'scripts/drag-preview-regression.mjs',
          'scripts/test-grid-guides-ui.mjs', 'scripts/test-global-guides-ui.mjs', 'scripts/test-docking-ui.mjs']
files += ['scripts/platform-runtime.mjs', 'scripts/start-desktop.mjs', 'scripts/audit-public-source.py', 'scripts/package-transfer.py',
          'scripts/test-interaction-events.mjs', 'scripts/test-interaction-authoring.mjs',
          'docs/PROJECT_OVERVIEW.md', 'docs/CONTRIBUTING.md', 'docs/SECURITY.md',
          'docs/ARCHITECTURE.md', 'docs/ROADMAP.md', 'docs/FEATURE_MATRIX.md',
          'docs/MAC_DEVELOPMENT.md', 'docs/CONTINUE_DEVELOPMENT.md',
          'docs/RELEASE_NOTES.md', 'docs/verification-preview.9.json', 'docs/verification-preview.10.json', 'docs/verification-preview.11.json', '.github/workflows/verify.yml',
          '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md',
          '.github/pull_request_template.md']
files += [p.relative_to(root).as_posix() for p in (root / 'app').rglob('*') if p.is_file()]
files += [p.relative_to(root).as_posix() for p in (root / 'tests').glob('*.mjs')]
files=sorted(set(files))
target.parent.mkdir(parents=True, exist_ok=True)
manifest=[]
contents = {}
for name in files:
        source = root / name
        source.resolve().relative_to(root.resolve())
        selected_parts = Path(name).parts
        candidates = [root.joinpath(*selected_parts[:index]) for index in range(1, len(selected_parts) + 1)]
        if any(item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()) for item in candidates):
            raise SystemExit(f'源码清单不能包含链接：{name}')
        content = (root / name).read_bytes()
        if name.endswith('.md'):
            # Keep the local click-by-click guide useful while publishing portable examples.
            portable_text = content.decode('utf-8').replace(str(root), r'C:\路径\yuanda').replace(root.as_posix(), 'C:/路径/yuanda')
            portable_text = portable_text.replace('新版已经生成。在地址栏粘贴：', '从源码构建后，在地址栏输入你的实际目录（以下为示例）：')
            content = portable_text.encode('utf-8')
        contents[name] = content
        manifest.append({'path':name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
contents['.gitignore'] = b'node_modules/\n.local/\ndist/\nreleases/\nresearch/\ntools/\n.agents/\n.codex/\n*.log\n.DS_Store\ndata/\n'
contents['SOURCE-MANIFEST.json'] = json.dumps({'version':version,'files':manifest},ensure_ascii=False,indent=2).encode('utf-8')
if args.stage:
    stage = args.stage.resolve()
    # A publication tree is a generated project-local artifact, never an arbitrary destination.
    stage.relative_to(root.resolve())
    if stage.exists():
        raise SystemExit(f'为保留已有产物，停止覆盖：{stage}')
    for name, content in contents.items():
        destination = stage / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    print(f'已准备公开源码目录：{stage}（{len(contents)} 个文件）')
    raise SystemExit(0)
with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, content in contents.items():
        archive.writestr(name, content)
with zipfile.ZipFile(target) as archive:
    if archive.testzip() is not None:
        raise SystemExit('ZIP 完整性检查失败')
print(f'已生成并验证：{target}（{len(files) + 2} 个文件，SHA-256 {hashlib.sha256(target.read_bytes()).hexdigest()}）')
