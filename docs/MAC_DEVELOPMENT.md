# 在 Mac 上继续开发原搭

源码可以继续在 Mac 上开发。当前增加了 Mac 原生运行路径、项目内依赖安装、开发启动和本机 `.app` 打包入口；**这些改动已在 Windows 做路径单元检查和回归，尚无 Mac 实机验收结果**。Windows 的 `.exe` 不能直接变成 Mac 应用，也不要把 Windows 的 `node_modules` 复制过去使用。

## 1. 把项目放到自己的开发文件夹

在 Mac 的 **访达（Finder）** 中解压源码包，放到自己有写入权限的目录。也可以从 GitHub 克隆源码。整个项目目录要保留；不要只取 `app` 文件夹。

源码包不需要原电脑的 Axure 安装文件、逆向工具、运行缓存或 Agent 临时令牌。已有设计可以单独携带 `.yuanda` 工程，在新电脑用“打开”载入。`.rp` 是有限范围的导出格式，不能代替原搭完整工程的往返保存。

## 2. 首次安装依赖

打开 Mac 的 **终端（Terminal）**。输入 `cd` 和一个空格，把解压后的项目文件夹拖进终端，再按回车。之后的命令都在这个终端窗口完成。

先检查 Node.js：

```sh
node --version
npm --version
```

开发脚本要求 Node.js 22.12.0 或更新版本，并且带有 npm。若显示找不到命令，先在这台 Mac 上准备 Node.js；原搭的安装脚本不会替你修改系统或安装全局工具。Apple 芯片使用原生 arm64 Node，Intel Mac 使用 x64 Node。用下面的命令确认当前环境：

```sh
node -p "process.platform + ' / ' + process.arch"
```

应显示 `darwin / arm64` 或 `darwin / x64`。然后安装项目依赖：

```sh
node scripts/setup.mjs
```

成功时显示“安装完成”。它执行锁定版本的依赖安装，使用本机对应的 Electron，下载缓存和临时目录均在项目 `.local` 内，不安装用户级 Skill/MCP，也不修改用户级客户端配置。npm 的 Unix/Windows 安装布局不同，脚本会定位 npm 的 JavaScript 入口。[npm 目录规范](https://docs.npmjs.com/cli/v11/configuring-npm/folders/)

## 3. 打开开发版

仍在 **终端** 执行：

```sh
node scripts/start-desktop.mjs
```

预期出现原搭桌面窗口；之后可以在该窗口编辑。日志、恢复和本地元件库保存在项目 `.local` 中。关闭原搭后，终端返回命令提示符。

macOS 的 Electron 可执行文件位于 `Electron.app/Contents/MacOS/Electron`，成品源码资源位于 `.app/Contents/Resources/app`。统一路径模块已处理这些差异。[Electron 应用打包规范](https://www.electronjs.org/docs/latest/tutorial/application-distribution)

## 4. 在 Mac 上运行自测

在 **终端** 执行：

```sh
node scripts/test-all.mjs
```

它按组执行数据模型、编辑器、HTML 和 Agent 的测试，结束后在 `.local/release-audit` 写入对应版本的报告。每组桌面测试使用自己的隔离目录。运行期间不要修改源码，否则“源码未变化”的审计会如实失败。

只检查路径与开发入口，可以运行：

```sh
node --test tests/platform-paths.test.mjs
```

路径单测通过只代表路径规则正确，不能替代 Mac 上的真实桌面测试。临时文件同时设置 `TMPDIR`、`TMP` 和 `TEMP`，因为非 Windows 平台优先读取 `TMPDIR`。[Node.js 临时目录规则](https://nodejs.org/api/os.html#ostmpdir)

## 5. 在这台 Mac 上生成可双击的开发包

先关闭正在进行的自测，再在 **终端** 执行：

```sh
node scripts/build-desktop.mjs
```

成功后在 **访达** 打开项目 `dist` 文件夹，再打开对应版本目录，双击 `原搭.app`。请保留整个版本文件夹：

```text
dist/原搭-版本号/
  原搭.app/                  应用本身
  projects/                  可编辑演示与自己的工程
  exports/                   导出文件
  data/                      运行后生成的恢复、日志、Agent连接
  Agent-MCP配置.json
  Agent-Codex配置.toml
  BUILD-INFO.json
  先读我.txt
```

这是放在可写开发目录内使用的便携开发包。数据写在 `.app` 旁，不写进应用签名包内部。**暂时不要单独把 `.app` 拖到 `/Applications`**。构建脚本会拒绝覆盖已有版本目录；需要重复构建时，先保存并关闭旧版，把旧版本文件夹改名保留，或修改项目版本后再构建。

本机成品检查：

```sh
node scripts/test-desktop.mjs --portable
node scripts/test-agent-mcp-desktop.mjs --portable
node scripts/verify-release.mjs
```

Mac 构建会更新主程序及 Helper 的品牌信息，并使用系统 `plutil`、`codesign` 生成及验证本机临时签名。这个签名**不等于 Developer ID 签名，不含 Apple 公证**，也不是已验证可向其他 Mac 用户分发的正式安装包。面向他人分发时还需要在 Mac 上建立 Developer ID 签名、公证和发行验证流程；不要用关闭系统安全功能代替这些工作。[Electron 签名与公证说明](https://www.electronjs.org/docs/latest/tutorial/code-signing)

## 6. 在新电脑连接 Agent

先打开这台 Mac 上的原搭，再从原搭的 Agent 面板复制本机生成的连接配置。开发版命令指向本机 Electron，成品版命令指向本机 `.app` 内的可执行文件；配置只应放进当前项目的 `.codex/config.toml`。

不要复用旧电脑的绝对路径、`connection.json` 或令牌。移动整个版本文件夹后，也要从正在打开的原搭重新复制连接说明。客户端成功读取配置、发现工具和实际编辑成功是不同阶段，以工具列表和一次实际操作的结果为准。

## 平台入口的历史验证及剩余工作

preview.9 平台入口开发期间在 Windows 实际完成以下检查，当前发行结果另见 [发布记录](RELEASE_NOTES.md)：

- 8 条路径/缓存/npm 定位/资源复制与 plist 更新单元检查通过，其中 Mac 目录复制使用模拟文件树，未执行 Mac 程序。
- 源码桌面启动、文件往返与导出 19 项通过；标准 MCP 与桌面联调 13 项通过。
- 样式 UI 的 13 项行为检查通过、无控制台错误；该次总报告因并行开发期间源文件变化而未通过来源冻结审计，不能作为正式全量通过记录。正式版本的完整结果以该版本的交付验证文档为准。

必须在 Mac 实机验证的内容仍包括：Electron 下载安装、原生启动、窗口和菜单行为、Command 快捷键与中文输入、字体与高分屏、系统剪贴板/图片拖入、文件对话框、保存重开、HTML/RP 导出、Agent stdio 联调以及 `.app` 打包/签名校验。preview.10 的页面目录树支持 Cmd 加方向键，但对应 Mac 真机操作也待验证。现有部分菜单仍按 Windows 键位显示，原生 macOS 菜单、Finder 文件关联和安装到 `/Applications` 的数据位置尚未专门适配。没有将 Windows 上的路径模拟检查宣称为 Mac 实机验收。

## 相关文件

| 文件 | 用途 |
| --- | --- |
| `app/platform-paths.mjs` | 三个平台的 Electron/成品路径，以及 Mac 便携数据根目录 |
| `app/main.mjs` | 使用真实 Electron 执行路径生成 MCP 配置，选择便携数据根目录 |
| `scripts/platform-runtime.mjs` | npm 定位、项目缓存环境、隔离运行时复制、plist 字符串更新 |
| `scripts/setup.mjs` | 项目内安装依赖 |
| `scripts/start-desktop.mjs` | 启动本机开发版 |
| `scripts/build-desktop.mjs` | Windows 便携包和 Mac 本机开发 `.app` 打包 |
| `scripts/test-all.mjs`、`scripts/test-*.mjs` | 使用同一平台路径规则的自动检查 |
| `scripts/verify-release.mjs` | 成品源码逐文件比对；Mac 另核验本机签名完整性 |
| `tests/platform-paths.test.mjs` | 路径与开发入口单元检查 |
