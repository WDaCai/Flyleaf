# 整页嵌入 draw.io（diagrams.net）

2026-10-28。覆盖 `FRAMEWORK_CANVAS_PLAN.md` 里「不嵌 diagrams.net / 自研 SVG 当主画布」。

外壳仍是 lite / WebView2。不做同步站点，不做 Electron 大包主线，不重写笔记架构。大纲继续以框架 Markdown 为真相。

## 选型

| 方案 | 体积 | 结论 |
| --- | --- | --- |
| 自托管整份编辑器打进安装目录 | diagrams.net v32.6.1 的 draw.war 压缩 46.7 MB，解压后更大。lite 壳本身是数 MB 级 | 默认不打包。形状库要整份 webapp 才齐，裁一截会缺库，也不好验证 |
| 官方 embed + postMessage | 安装包不增加 | 默认。地址是 https://embed.diagrams.net/ |
| 安装目录里已经有自托管页面 | 体积由这份静态资源自己决定 | 优先用它，这样可以离线 |

探测：打开画布时 GET `/drawio/index.html`。响应像 draw.io（含 `app.min.js` / `mxgraph` / `diagrams.net`）才用。像本应用自己的 index.html（含 `/src/main.tsx`）或 404，就改走官方 embed。静态服务对带扩展名的缺失文件返回 404，不会把主站 index.html 塞进画布。

离线落地方式：把 diagrams.net 的 webapp 放到安装目录 `renderer/drawio/`（入口 `index.html`）。应用会优先加载它。本仓库不下载、不提交这份资源。

## 协议

iframe 查询：`embed=1`、`proto=json`、`ui=atlas`、`spin=1`、`configure=1`、`lang=zh`、`saveAndExit=0`、`noExitBtn=1`、`stealth=1`、`offline=1`，并关掉 Google / Dropbox / OneDrive / GitHub / GitLab / Trello 入口。`dark=1` 或 `0` 跟外壳 `data-theme` 走。换主题会重载 iframe，内存里的 XML 再 load 回去。

宿主只认这些来源的消息：`embed.diagrams.net`、`app.diagrams.net`、`viewer.diagrams.net`、`*.diagrams.net`、`draw.io`，以及自托管时的本页 origin。

| 编辑器事件 | 宿主 |
| --- | --- |
| configure | 回 action configure |
| init | action load，带 xml 和 autosave 1。若是从旧节点文件迁入，这时写盘 |
| autosave | 防抖约 400ms 写入笔记库，再回 status、modified false，避免另存为对话框 |
| save（工具栏或 Ctrl+S） | 立刻写盘，同样回 status |

第一条 autosave 当成加载回声，不写盘。坏文件在编辑器获得焦点之前不覆盖。外壳不弹另存为。

## 存盘

路径不变。

| 入口 | 文件 | 内容 |
| --- | --- | --- |
| 知识框架的画布 | 同目录 foo.md 对应 foo.canvas.json | version 2，format drawio，xml 为 mxfile |
| 梳理画布 | .yan/scratch/id.flycanvas.json | 同上，mode scratch，带 title |

新建梳理画布直接写空 mxfile。没有旧文件的框架画布，用户改图之后才落盘。

单份 XML 上限 6000000 字符（API body 上限 32MB）。超过则拒绝保存，原文件不动。

## 旧文件

| 情况 | 行为 |
| --- | --- |
| 已是 version 2 且 XML 合法 | 原样打开 |
| version 1，有节点或自由边 | 收成 mxfile：位置和形状保留；文案优先用大纲标题；大纲父子只在两端都在旧文件里时补成正交边；大纲里没有的节点画成虚线并标（失效）。legacy 字段留下旧节点和边。编辑器 init 成功后写 version 2，写之前把原文复制为同名 .bak（只一次） |
| version 1 但是空的 | 当空白图，不提示迁入 |
| JSON 坏了、版本不认识、XML 不合法、读失败 | 打开空白图并说明原因。先不改原文件。用户改图并保存之后才覆盖，覆盖前同样复制 .bak |
| 文件不存在 | 空白图，不提示 |

.bak 不进文件树（树只列 .md），也不进梳理画布列表。删除梳理画布时，.flycanvas.json 和它的 .bak 一起删。框架笔记的 .canvas.json.bak 不随笔记删除自动清（本刀没有这条级联）。

迁入之后，大纲和这张图分开存。改 Markdown 不会再推动图上的节点。

## 外壳

- `shell/lite/Host.cs`：`IsZoomControlEnabled = false` 保持，并加上 `IsPinchZoomEnabled = false`。整页 Ctrl+滚轮和捏合不再把 WebView2 放大，缩放留在 draw.io 里。
- 外壳颜色仍用 Flyleaf tokens。编辑器内部用 draw.io 自己的浅色或深色。
- 父页面不监听画布滚轮。iframe 聚焦时，Ctrl+P 等外壳快捷键不会冒泡出来；点回顶栏或侧栏后恢复。Backspace 也不会误删笔记。

## 入口

| 入口 | 文案 |
| --- | --- |
| 侧栏 | 知识框架、梳理画布 |
| 顶栏分段 | 大纲、画布。画布是整页编辑器 |
| 命令面板 | 打开知识框架、新建框架笔记、打开当前框架的画布、打开当前框架的大纲、新建梳理画布、打开梳理画布 |
| 随记 | 按钮仍是「开梳理画布」 |
| 快捷键 | Ctrl+M 仍在大纲和画布之间切换 |

## 不做

同步站点、Electron 主线、把 46.7MB 的 war 打进仓库或 `E:\Flyleaf`、画布上改 Markdown、节点和大纲双向高亮、文件改名时级联旁路。

## 验收

1. 知识框架，再点画布：整页是 draw.io（工具栏、缩放、连线、形状）。改完重开仍在，旁路是 foo.canvas.json，且没有另存为对话框。
2. 侧栏「梳理画布」、命令面板、随记「开梳理画布」打开的也是整页 draw.io。删梳理画布只动 `.yan/scratch` 下的画布文件。
3. 大纲仍可增删改、调层级、改掌握度。画布上的操作不新建笔记。
4. 浅色 / 深色切换后，外壳跟 token，编辑器跟 dark。
5. 旧的有节点的 .canvas.json / .flycanvas.json 能开成图；坏文件有说明，原文还在，保存后出现 .bak。
6. 断网时：默认编辑器连不上，有提示，已保存的文件不被清空。若 `renderer/drawio/index.html` 可用，则走本地。
7. `npm run check` 与 `npm run build:lite`，产物刷到 `E:\Flyleaf`。主窗滚轮不会把整个 Flyleaf 页面放大（Host 里整页缩放仍关着）。

## 已知限制

- 默认打开编辑器需要访问 embed.diagrams.net。图本身在笔记库，不经过他们的云盘。
- 自托管资源没有打进安装包。要离线，需自行放入 `renderer/drawio/`。
- 迁入只发生一次。之后大纲和图各自保存，选中行不再互相同步。
- 编辑器聚焦时，外壳快捷键要先点回外壳。
- draw.io 可能把 XML 压成图内的 base64。重开仍然能读。legacy 和 .bak 留着旧的节点 JSON。
