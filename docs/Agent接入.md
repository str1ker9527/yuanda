# 本地 Agent 接入（0.2.0-preview.9）

原搭 0.2 的人工操作和 Agent 指令进入同一个文档引擎。Agent 可以创建、修改、删除页面和元件，配置样式、母版、变量、动态面板、数据列表、自适应视图和交互；修改会出现在画布，并进入同一份撤销记录。

新版增加了**标准 MCP 直接控制入口**。Codex 等支持 MCP 的 Agent 可以直接读取当前项目、创建和修改元件、切换选区、撤销重做、保存工程以及导出 HTML/RP。你不需要把命令复制到「Agent 工作台」。软件没有内置大模型账户或云端聊天服务；Agent 通过本机接口操作你正在打开的原搭窗口。

MCP 是可调用的工具接口；Skill 可以补充工作习惯和设计方法，本身不能代替写入接口。本版使用 MCP → 已鉴权本机 HTTP → 同一个文档引擎，人工与 Agent 共享校验、画布和撤销记录。MCP 不操作鼠标，也不能读取任意文件或执行系统命令。

发布和测试状态以对应版本的交付记录为准。旧版 preview.6 的 HTTP 入口不会因为新增配置而获得本版能力。MCP 协议测试通过、桌面联调通过、Codex 当前会话已发现工具是三个不同状态；不要把安装配置成功当作当前会话已经连接。

图片可通过 `setImageOptions` 调色、翻转、设置角部或叠字，也可用 `cropImage`、`sliceImage`、`replaceImage`、`fitImage`、`clearImage`。先从 schema 读取限制和真实元件 ID，再携带 expectedRevision 提交。图片内容在全部视图共享；外框尺寸才按 viewCommands 的范围处理。图片 src 是内嵌数据，不是电脑文件路径；HTTP 不提供任意文件读取。

样式契约以运行窗口返回的 schemaRevision 为准，preview.9 源码为 11；连接旧版时以实际返回值为准：Agent 可以修改字体/行距/字距、渐变或图片填充、独立边框/圆角、阴影、模糊、过渡和旋转原点。先查询 schema；复合字段整体替换，例如提交完整 padding 四边，不能只给一个 top。状态字段省略表示跟随基础值；修改局部样式保留命名样式关联，并记录局部覆盖；清除覆盖可恢复继承。

视图编辑需要明确范围。例如让 Agent “只调整手机布局”，应读取视图 ID，再使用 `viewCommands`，指定 `viewId` 与 `scope:"current"`；不要根据编辑器当前选中的视图猜测。指定 `scope:"all"` 才表示全部视图。文字和交互共享，改变它们会作用于所有布局。实例平移使用 `moveNodes`，而非分别修改每个关联元件。

## 不懂代码时怎么使用

1. **原搭窗口**：打开新版 `原搭.exe`，打开你要修改的工程。保持窗口运行。
2. **Codex 等 MCP 客户端窗口**：加载本项目或便携版提供的 MCP 配置。配置指定同一版原搭的连接文件；工具列表中应能发现 `yuanda_get_state` 等 12 个工具。工具未发现属于客户端连接问题，不需要往画布里粘贴命令。
3. **Codex 聊天窗口**：直接说出你要改什么。例如：

> 用原搭 MCP 读取当前项目和编辑能力，将首页预约按钮改成深灰色，文字改为“申请体验”。先预检，再直接修改，最后在原搭选中这个按钮。保留其他内容。

Agent 会调用工具直接写入原搭，画布会同步变化。你仍可在**原搭窗口按 Ctrl+Z**撤销整批修改。可以继续说“保存工程并导出 HTML”或“检查当前项目能否导出 RP”。若 RP 遇到暂不支持的内容，工具会解释原因，不能将内容静默删掉再假称完整导出。

## MCP 配置与启动

以下便携路径和 EXE 示例用于 Windows；Mac 的应用包与运行数据位置见 [Mac 开发与迁移指南](MAC_DEVELOPMENT.md)。路径统一以实际应用返回的 `getAgentInfo` 为准。preview.9 的新平台联调结果需独立验证，不继承旧版结论。

Codex 的项目级 MCP 配置写在受信任项目的 `.codex/config.toml`；本项目保持该范围，不修改用户级配置。依据：[OpenAI 官方 MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。新配置是否已被当前会话发现，需要查看客户端实际工具列表；配置文件存在本身不等于已连接。

源代码使用 `node scripts/yuanda-mcp.mjs --connection <连接文件绝对路径>`。完整便携版使用自身携带的 Electron/Node 运行 MCP，无需另装 Node.js：

```json
{
  "command": "<新版便携版目录>/原搭.exe",
  "args": [
    "<新版便携版目录>/resources/app/scripts/yuanda-mcp.mjs",
    "--connection", "<新版便携版目录>/data/connection.json"
  ],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

这是各客户端配置的字段说明，不是要粘进聊天框的指令。若使用 Codex，可在受信任仓库的 `.codex/config.toml` 自行添加配置；公开源码不附带某台机器的客户端配置。其中命令、脚本、连接文件必须指向同一版本的实际绝对路径。MCP 进程不新开编辑器，不自动加载另一个工程。它只连接已打开的窗口。未打开原搭时仍可发现工具，读取项目会返回明确的“请先打开原搭”错误。

应用的 `getAgentInfo` 返回本版本的 `mcp.command/args/env`，供接入配置使用。每次调用重新读取连接文件中的临时令牌，重启原搭后无需把新令牌粘给 Agent。配置和项目中不得写入令牌。

| MCP 工具 | 用途与输入 |
| --- | --- |
| `yuanda_get_state` | `{}`，读取完整项目、版本、选区、保存状态和能力 |
| `yuanda_get_schema` | `{}`，读取运行窗口的实际编辑契约 |
| `yuanda_get_selection` | `{}`，只读取当前选区与版本 |
| `yuanda_list_libraries` | `{}`，列出已登记库 |
| `yuanda_get_library` | `{libraryId}`，读取一个已登记库 |
| `yuanda_validate_commands` | `{expectedRevision,commands,label?}`，只检查，不修改 |
| `yuanda_apply_commands` | `{expectedRevision,commands,label?}`，原子应用一批修改 |
| `yuanda_undo` / `yuanda_redo` | `{expectedRevision}`，撤销或重做 |
| `yuanda_select` | `{expectedRevision,pageId,nodeIds}`，同步桌面选区 |
| `yuanda_save` | `{expectedRevision,name?}`，保存工程；名称不能是路径 |
| `yuanda_export` | `{expectedRevision,format:"html"或"rp",name?}`，导出到 exports 新文件 |

保存已有工程使用它的当前路径；未保存工程写入原搭 projects 目录。导出使用 exports 目录中的新文件，不覆盖已有同名文件。工具不接受任意文件路径。保存、导出、选区与预检先检查运行窗口声明的能力，连接旧版时会明确拒绝，不会虚报成功。

## 旧 HTTP/CLI 方式仍可使用

**窗口：原搭主窗口。**打开「Agent 工作台」，点击「复制 Agent 接入说明」查看连接位置。若继续使用旧 HTTP/CLI，按下方连接文件表选择同一版本的文件。

**窗口：Codex 聊天窗口。**粘贴说明，再写你要改什么。例如：

> 请读取原搭当前项目，把首页预约按钮改成深灰色，文字改为“申请体验”。先读取 state 和 schema，再提交带 expectedRevision 的命令。保留其他内容，完成后告诉我改了哪些元件。

Agent 应读取实际页面和元件 ID，不要凭名称猜 ID。你可以在原搭按 `Ctrl + Z` 撤销。可从样式、母版或交互等小范围修改开始，确认结果后再做更大批次。人工正在输入时，无关的 Agent 修改不会清掉文字草稿；同一文字发生冲突会保留草稿，让人选择替换、另存为新文字或采用最新内容。

## 连接文件和入口

以下均为相对仓库根目录的路径；搬到另一台电脑后使用实际位置。

| 启动方式 | 连接文件 | CLI 文件 |
| --- | --- | --- |
| 源码启动 | `.local/yuanda-agent/connection.json` | `scripts/yuanda-agent.mjs` |
| preview.9 Windows 便携版 | `dist/原搭-0.2.0-preview.9/data/connection.json` | `dist/原搭-0.2.0-preview.9/resources/app/scripts/yuanda-agent.mjs` |

原搭启动后创建连接文件，正常退出时清理。文件包含 `{version,url,token,pid}`。端口和临时令牌可能每次变化，因此每次连接都应重新读取。不要提交连接文件、恢复数据或令牌到 GitHub。

打开原搭无需 Node.js；便携版 MCP 同样无需系统 Node.js。下面的旧 CLI 示例使用系统 Node.js，也可以由 Agent 直接发起本机 HTTP 请求。源码与便携版同时开着时，必须选对连接文件，避免改到另一个窗口的项目。

## 用 PowerShell 读一次，再改一次

先打开新版原搭，在 PowerShell 中进入仓库根目录。下面示例连接这个仓库内的新版便携版；源码启动时，将连接文件改为 `.local/yuanda-agent/connection.json`。

**窗口：Windows PowerShell。第一段只读取。**

```powershell
$yuandaCli = Join-Path (Get-Location) 'scripts/yuanda-agent.mjs'
$yuandaConnection = Join-Path (Get-Location) 'dist/原搭-0.2.0-preview.9/data/connection.json'
node $yuandaCli state --connection $yuandaConnection
node $yuandaCli schema --connection $yuandaConnection
```

应输出当前项目、版本号和接口说明。下面重新读取版本，在第一张页面添加一段文字；页面 ID 自动从项目获得。

```powershell
$yuandaCurrentText = node $yuandaCli state --connection $yuandaConnection
if ($LASTEXITCODE -ne 0) { throw '读取项目失败，请确认原搭已打开及连接路径正确' }
$yuandaCurrent = $yuandaCurrentText | ConvertFrom-Json
$yuandaBatch = @{
  expectedRevision = $yuandaCurrent.revision
  label = 'Agent 添加欢迎语'
  commands = @(@{
    type = 'addNode'
    pageId = $yuandaCurrent.project.pages[0].id
    node = @{
      id = 'agent-' + [guid]::NewGuid().ToString('N')
      type = 'text'
      name = 'Agent 欢迎语'
      text = '这是 Agent 直接写入的元件'
      x = 80; y = 100; width = 520; height = 56
      style = @{ fontSize = 28; color = '#191919' }
    }
  })
}
$yuandaLocal = Join-Path (Get-Location) '.local'
New-Item -ItemType Directory -Force -Path $yuandaLocal | Out-Null
$yuandaBatchPath = Join-Path $yuandaLocal 'agent-demo-commands.json'
$yuandaJson = $yuandaBatch | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($yuandaBatchPath, $yuandaJson, [System.Text.UTF8Encoding]::new($false))
node $yuandaCli apply $yuandaBatchPath --connection $yuandaConnection
```

**窗口：原搭主窗口。**切到第一张页面，应看到新文字。撤销或重做也可在刚才的 PowerShell 中执行：

```powershell
node $yuandaCli undo --current --connection $yuandaConnection
node $yuandaCli redo --current --connection $yuandaConnection
```

`--current` 用于在撤销或重做前获取当前版本。正常编辑采用“读取 → 计算修改 → 使用读到的版本提交”，不要用 `apply --current` 掩盖基于旧内容计算的修改。CLI 支持 `state`、`schema`、`libraries`、`library <库ID>`、`apply <jsonfile>`、`undo`、`redo`；也可通过环境变量 `YUANDA_CONNECTION` 指定连接文件。

## HTTP 接口和事务

服务仅监听 `127.0.0.1` 的随机端口。请求携带 `Authorization: Bearer <token>`，Host 必须对应实际监听地址与端口；带网页 `Origin` 的请求被拒绝。不提供任意代码执行、系统命令或自由文件读写接口。

| 请求 | 内容 |
| --- | --- |
| `GET /v1/state` | 完整项目、revision、选区和应用状态 |
| `GET /v1/schema` | 当前支持的元件、字段、命令、事件、动作和表达式 |
| `GET /v1/libraries` | 已登记本地库、文件夹和条目摘要，无磁盘路径 |
| `GET /v1/libraries/:id` | 单个已登记库的 `{library,revision}`，供获取条目完整数据 |
| `POST /v1/commands` | `{commands,expectedRevision,label?}` |
| `POST /v1/undo` | `{expectedRevision}` |
| `POST /v1/redo` | `{expectedRevision}` |
| `POST /v1/validate` | `{commands,expectedRevision,label?}`，副本预检，不写文档 |
| `POST /v1/selection` | `{expectedRevision,pageId,nodeIds}`，同步桌面选区 |
| `POST /v1/save` | `{expectedRevision,name?}`，保存当前工程 |
| `POST /v1/export` | `{expectedRevision,format:"html"或"rp",name?}`，导出新文件 |

POST 使用 `Content-Type: application/json`，版本号为必填整数。一批命令全部成功或全部回滚；真正改变文档才增加 revision。旧版本提交返回 HTTP 409 / `REVISION_CONFLICT`。收到冲突应重读项目、重新计算，再提交；不能只把旧请求的版本数字改新。

**预检支持 MCP、HTTP 与桌面。**`yuanda_validate_commands`、`POST /v1/validate`、「Agent 工作台 → 检查指令」和桌面桥 `window.yuanda.validateCommands({commands,expectedRevision})` 都在文档副本上执行整批校验，不修改项目和历史。预检不锁住项目；正式提交仍校验版本。旧 CLI 尚没有新增的预检、保存和导出子命令，直接使用 MCP 工具即可。

## Agent 需要遵守的编辑规则

- 先读 `state` 和 `schema`。schemaRevision 是编辑接口契约版本，项目文件版本仍为 1，二者不同。
- `addNode` 可只给必要字段；`updateNode.patch.style` 局部合并，`interactions` 整体替换。普通文字编辑会清除旧富文本，除非提供同步的新富文本结构。
- 复杂复制使用 `duplicateNodes`；需要保留复制时内容则用 `pasteFragment`。它们会映射内部节点、组、状态、数据行和交互引用，不要手工复制 ID。
- `pasteFragment` 接收同项目快照 `{projectId,sourceId,nodes,groups,views,nodeIds,viewState?,appearance?}`。快照保存整个源画布、选中 ID、视图定义与外观；原件修改或删除不改变快照。优先使用编辑器捕获的完整快照；结构见开发接口约定。当前不合并不同项目的剪贴板资源。
- 移动动态面板或中继器用 `moveContainer`，移动完整组用 `moveGroup`。单独改节点 `x/y` 不会自动移动所有后代。
- 动态面板状态用 `duplicatePanelState` 复制、`reorderPanelState` 排序；布局用 `setPanelOptions`。预览的拖动/滚动事件提供 `event.deltaX/deltaY/scrollX/scrollY`；手动设计宽高会关闭内容自适应。
- 复用已登记库：CLI `libraries` 列摘要、`library <库ID>` 取完整库；再把 `library.items` 中的条目放进 `insertLibraryItem {pageId,item,x?,y?,conflictPolicy:"copy"}`。原有资源不覆盖，新导入的同名变量/样式/母版加序号；项目写入仍带整数 `expectedRevision`。库内容摘要 revision 是字符串，与项目版本号不同。
- 改变归属或同级顺序用 `reparentItems`，新建嵌套组用 `groupItems`，整体缩放普通组用 `resizeGroup`。父组和父容器的锁定也会阻止内部编辑；关联实例不能被拆散或静默解除关联。
- 列表初始分页用 `setRepeaterPagination`，初始标记用 `setRepeaterMarks`。CSV/Tab 批量导入用 `importRepeaterData`，明确每个已有目标列的来源和追加/替换模式。错误数字会拒绝整批写入；替换会清空标记并回到第 1 页，仍可一次撤销。
- 母版画布用 `componentCommands {componentId,commands}`。子命令的 `pageId` 省略或等于该母版 ID；可包一层 `viewCommands` 固定编辑视图与范围，不能再次嵌套 componentCommands 或 viewCommands；禁止跨画布操作和项目级结构修改。
- 母版实例文字/图片用 `setComponentOverride`，`sourceId` 来自实例组的 `sourceIds`，与 `nodeIds` 一一对应。清除用 `clearComponentOverride`。整实例移动用 `moveNodes`，放置用 `setNodesPlaced`，选固定/自动视图用 `setComponentInstanceView`；需要当前视图范围时用 `viewCommands`。其他实例内部内容修改应改母版主定义或先解除关联。
- 条件和动态值使用可序列化表达式树，不能发送 JavaScript、脚本 URL 或代码字符串要求执行。变量、节点、状态和数据列引用必须有效。
- 输入框的 `inputType` 支持 text/password/number/email/date/tel/url/search。`readOnly` 与 `maxLength` 适用于 input/textarea；number/date 的 maxLength 必须为 null。只读阻止访客键盘输入，但交互仍能设置值。
- 图片使用内嵌 PNG/JPEG/WebP/GIF，单张最多 4 MiB。创建或更新仍须经过完整模型校验，不能直接写未知字段。

详细结构和命令签名见源码包中的 `docs/开发接口约定.md`。实际可用范围以当前运行应用返回的 schema 和校验结果为准；连接旧版窗口不会自动获得新版能力。

## 界面内的工作台

可以粘贴命令数组，或 `{"commands":[...]}`，点击「检查指令」后再「应用修改」。工作台记住检查时的 revision；检查后项目有变化会要求重新检查。令牌不需要粘进这个文本框。应用后的整批修改可以一次撤销。

本地 Agent 编辑的是原搭当前工程。基础 `.rp` 导出已有用户样本验收，但不等于支持任意 Axure 文件的导入或全部元件、交互的无损互转。原搭 `.yuanda` 工程仍保留完整编辑数据；分享可选择 `.rp` 或 HTML。具体 RP 支持范围以当前导出校验和交付记录为准。

## 开发与打包检查

- 桥接入口：`scripts/yuanda-mcp.mjs`；协议和固定 HTTP 路由：`app/agent-mcp.mjs`；HTTP 服务：`app/agent-server.mjs`。
- 根目录 `package.json` / `package-lock.json` 固定官方 `@modelcontextprotocol/server` / `core` 2.3.1 和 `zod` 4.4.3，源码使用 `node scripts/setup.mjs` 安装。便携版已由构建脚本携带这三个完整依赖包及许可到 `resources/app/node_modules`，不需要本机研究工具。
- `node --test tests/agent-mcp.test.mjs` 验证真实 stdio 握手、工具发现、HTTP 读写、原子回滚、撤销重做、错误令牌拒绝、连接文件校验，以及预检、选区、工程保存和 HTML 输出。测试目录只在 `.local/agent-mcp-tests`，结束后清理。
- 沙箱可能拒绝本机 TCP；`EACCES 127.0.0.1` 是运行环境限制，须在允许本机回环连接的环境测试，不能据此声称应用接口已损坏。测试通过也不等于某个客户端会话已发现工具，须单独确认客户端连接状态。
