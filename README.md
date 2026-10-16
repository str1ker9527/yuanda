# 原搭 · Yuanda

**可以用鼠标编辑，也可以由 AI Agent 直接读写的桌面原型工具。**

原搭使用原创文档模型和交互运行器，把页面设计、桌面编辑、可撤销的 Agent 修改和独立 HTML 交付连接起来。它参考成熟原型工具的工作流，目标是持续覆盖 Axure 的核心能力；当前仍是开发预览项目，不能视为完整替代品。

Yuanda is an independently implemented desktop prototyping editor with a shared command model for people and local AI agents. It supports editable projects, interactive HTML export, and a limited native RP export subset. Windows is the validated platform; macOS development is in progress. See the [feature matrix](docs/FEATURE_MATRIX.md), [architecture](docs/ARCHITECTURE.md), and [contribution guide](docs/CONTRIBUTING.md).

## 能做什么

- **桌面编辑**：页面与文件夹混合树、概览、标签与画廊，菜单和右键，多选、组合、锁定、层级、标尺、网格、参考线和吸附；面板可在主窗口内移动、合并与停靠。
- **可复用设计**：16 种基础/容器元件，共享样式、母版和实例、自有本地元件库、自适应视图、图片与矢量编辑。
- **交互原型**：事件、条件分支、变量和顺序动作；动态面板、数据列表的筛选/排序/分页，以及表单和跨页交互。
- **Agent 直接控制**：标准 MCP 读取实际工程、预检、批量修改、选择、撤销、保存和导出；与鼠标编辑共用版本检查和历史。
- **交付文件**：完整可编辑 `.yuanda`、自有库 `.yuandalib`、独立交互 `.html`，以及支持子集内的原生 `.rp`。

完整范围与差距见 [162 项能力清单](docs/FEATURE_MATRIX.md)。当前版本 **0.2.0-preview.10** 在 Windows 完成 48 组固定应用源码下的分批检查，模型/接口 407 项、成品桌面 19 项、成品 MCP 16 项通过。两批分别覆盖前 4 组和后 44 组，不是单次全绿运行；检查范围、修复记录与 63 份源码哈希见 [发布记录](docs/RELEASE_NOTES.md) 和 [验证摘要](docs/verification-preview.10.json)。

## 从源码运行

安装 Node.js **22.12.0 或更新版本**及随附 npm。打开终端，进入下载或克隆的仓库根目录：

```text
node scripts/setup.mjs
npm test
npm start
```

安装和首次运行需要下载依赖；缓存放在项目内。`npm start` 打开独立桌面窗口，不需要部署网站。`npm test` 是模型与接口检查，不等于全量桌面验收。

**Windows：**已提供源码与便携构建流程。运行 `npm run build` 后，在生成的版本目录内双击 `原搭.exe`，保留整个目录；便携程序不需要另装 Node.js。不要从源码 ZIP 中寻找尚未构建的 EXE。

**macOS：**从 [Mac 开发与迁移指南](docs/MAC_DEVELOPMENT.md) 开始。需要 Mac 真机验证启动、快捷键、权限、文件、MCP 和打包；当前不宣称已交付签名/公证的苹果应用。Linux 尚未作为已验收平台。

打开 `samples/yuanda/原搭体验-0.2.yuanda`，可体验三页原创演示。更多样本及每一步在哪个窗口操作，见 [试玩指南](docs/试玩指南.md)。

本轮页面目录示例是 `samples/yuanda/页面目录体验.yuanda`：在原搭「打开」载入，即可体验嵌套目录、拖动归类与跨页跳转；独立演示见 `exports/页面目录体验.html`。

## 让 Agent 直接操作

保持原搭窗口打开，在支持 MCP 的客户端配置本地原搭服务，再让 Agent 读取 `yuanda_get_state` 和 `yuanda_get_schema`。它可携带 `expectedRevision` 提交整批修改；原搭画布同步变化，用户可以整批撤销。

详细配置、工具列表与窗口步骤见 [Agent 接入](docs/Agent接入.md)。接口不要求手工粘贴 JSON，也不内置模型账号或云端聊天服务。连接文件含临时令牌，不要提交或分享。

本轮维护会话已实际发现服务并读取新版状态和 schemaRevision 12；写入能力由隔离的成品 MCP 检查验证，没有为连接检查修改用户工程。其他电脑或客户端仍需按接入指南配置并自行确认连接。

## 重要边界

| 项目 | 当前范围 |
| --- | --- |
| RP 互通 | 支持矩形、文字、按钮、多页、静态 PNG 和单个无条件单击跳页；页面文件夹及其他复杂内容明确拒绝。没有通用 RP 导入器或完整双向往返。 |
| 工程保存 | `.yuanda` 保留全部原搭编辑数据；不要只留 RP/HTML 后删除工程。 |
| 验证 | 基础 RP 曾有人工打开、编辑、保存、预览及重开验证；后续图片与跳页的结构检查不等于所有 Axure 版本实测。 |
| 桌面与云端 | 当前面板浮动限主窗口；应用内团队协作、云评审和完整 RPLIB 兼容尚未实现。 |

## 文档与开发

- [项目说明](docs/PROJECT_OVERVIEW.md) · [试玩指南](docs/试玩指南.md) · [Agent 接入](docs/Agent接入.md)
- [架构](docs/ARCHITECTURE.md) · [接口约定](docs/开发接口约定.md) · [文件说明](docs/文件说明.md)
- [能力清单](docs/FEATURE_MATRIX.md) · [路线图](docs/ROADMAP.md) · [继续开发交接](docs/CONTINUE_DEVELOPMENT.md)
- [贡献指南](docs/CONTRIBUTING.md) · [安全说明](docs/SECURITY.md) · [Mac 开发](docs/MAC_DEVELOPMENT.md)

```text
npm run test:all
npm run build
node scripts/test-desktop.mjs --portable
node scripts/test-agent-mcp-desktop.mjs --portable
node scripts/verify-release.mjs
```

完整检查覆盖模型、隔离桌面、HTML 与示例；成品检查和字节核对另行执行。检查范围、替身和未验证平台必须如实记录。源码 ZIP 可用 `python scripts/package-source.py` 生成，按白名单收录原创代码、文档、测试和自有样本。

## 开源与来源

原创应用采用 [MIT 许可证](LICENSE)。第三方依赖保留各自许可证。公开源码不包含 Axure 程序、反编译产物、内置素材库或私有运行脚本；Axure 名称仅用于说明兼容目标，不表示关联或官方认可。

项目仓库：[str1ker9527/yuanda](https://github.com/str1ker9527/yuanda)。这是持续开发的预览项目，源码验证不表示完整兼容或正式稳定版。欢迎提供去除个人信息的复现样本，或按能力编号讨论和贡献。
