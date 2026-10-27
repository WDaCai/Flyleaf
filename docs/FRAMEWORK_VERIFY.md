# 知识框架验收记录

日期：2026-10-28（Asia/Shanghai）

范围：大纲编辑闭环 + 导图跟手可读 + 两视图导航一致（方案审核收口）

## 优先级对齐

- 已做满：大纲 CRUD / 调层级 / 四档状态 / 图例 / 折叠 localStorage；导图 token 连线、适应窗口、缩放平移、工具栏中文；两视图共享折叠/高亮/当前节点；Ctrl+M；单击导图不建文件。
- 未做（按方案禁止）：导图虚拟化、自由拖节点、力导向、另存 JSON、导图上建文件、重动画换 d3、XMind 全功能。

## 自动门禁

- [x] `npm run check`（typecheck + boundaries + vitest 61 passed）
- [x] `npm run build:lite` → `E:\Flyleaf`（见本轮构建日志）

## 验收清单（实现对齐，安装目录点验）

### 大纲

1. 增删改节点（行内操作 + 空树「添加根节点」）
2. Tab / Shift+Tab（或升降按钮）调层级
3. 四档掌握度 `[ ]/[~]/[x]/[*]` + 顶栏图例计数
4. 折叠状态按框架 path 写入 localStorage，重开不丢
5. 改状态 / 折叠后切导图可见对应变化

### 导图

1. 节点文案用 `--sans`，连线用 `--mm-link`（无硬编码 `#2b323c`）
2. 工具栏「+ / - / 适应」中文正常
3. 「适应」按当前布局 fit，根落在视口内；换框架文件自动 fit
4. 滚轮缩放（非 passive）+ 拖拽平移，不抖
5. 单击：选中 + 按 NavTarget 导航；**绝不新建文件**
6. 双击：有子节点则折叠/展开

### 两视图导航

1. 共享 `collapsed` / `highlightLine`；大纲改状态/折叠 → 导图同步
2. Ctrl+M 切换 outline ↔ mindmap
3. 有关联笔记（`kind: file`）→ 打开文件；无文件（`kind: line`）→ 定位本框架 md 行并高亮
4. vault 仍是一份缩进 md，协议未改

### 规模

- 30～80 节点可用（全量渲染）
- >200 节点 toast「建议拆成多棵框架」
- >500 不宣称虚拟化；DESIGN.md / README 已保留已知限制一句

## 本轮代码要点

| 区域 | 变更 |
|------|------|
| `core/.../framework-service.ts` | `addNode` / `renameNode` / `removeNode(trashLinked)` / `shiftNode` |
| contracts + http/ipc/host/server/app-main | 接通上述 API |
| `Framework.tsx` | 大纲 CRUD UI、图例、空提示、滚动到高亮行、传 MindMap 选中 |
| `MindMap.tsx` | token 连线、fitView、选中高亮、单击不建文件、工具栏 |
| `App.tsx` | 折叠 LS、>200 toast、CRUD handlers、空态 CTA、Ctrl+M、同文件 line 高亮 |
| `styles.css` / `ui/tokens.css` | `.fw-ops`、`.mm-link`、掌握度色与 mm token |

## 结果

check ✅ · build:lite ✅（刷入 E:\Flyleaf）· 本机 git commit 见仓库日志
## draw.io 外观（手测）

本轮只改导图**外观**，数据仍是框架 md 缩进树；不拖节点、不嵌 diagrams.net、不另存 .drawio。

1. 画布：浅色/深色网格线（随平移缩放），空白拖拽 cursor grab/grabbing
2. 节点：圆角矩形卡片；左侧掌握度色条；选中有 accent 描边与阴影；长标题省略号，悬停 title 全量
3. 连线：正交折线（父右中 → 肘 → 子左中），非贝塞尔
4. 工具栏：底部居中小条 — 缩小 / 缩放% / 放大 / 适应；中文无乱码
5. 交互不变：单击导航/选中（不建文件）、双击折叠、滚轮缩放、大纲↔导图一致、Ctrl+M


## scratch 纯梳理画布（手测）

前置：`npm run check` 与 `build:lite` 已刷到安装目录；重启 Flyleaf。

1. **新建**：随记卡点「开梳理画布」，或侧栏「梳理画布 → 新建」→ 主窗打开空白画布。
2. **编辑**：选圆角/矩形/椭圆工具，点空白处建节点；拖位置；连线工具拉边；双击改文案；标题栏可改名。关再开同一份仍在。
3. **不碰笔记**：操作前后对照 vault 下 `00-inbox` 等笔记 md 列表（可用资源管理器或 `Get-ChildItem -Recurse -Filter *.md`），不应出现新建/改名/删除。
4. **删除**：侧栏该项点 × → 只删 `.yan/scratch/*.flycanvas.json`，inbox md 与回收站无新条目。
5. **bound 回归**：打开任一框架笔记 → 导图 → 拖节点/连线仍可用，旁路 `foo.canvas.json` 仍更新。
