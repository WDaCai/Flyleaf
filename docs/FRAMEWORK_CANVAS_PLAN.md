# 自由画布（框架导图）· 可执行定稿

> **变更（2026-10-28）**：框架画布和梳理画布的主路径已改为**整页嵌入 diagrams.net（draw.io）**。本文件里「不嵌 diagrams.net」「自研 SVG 当主画布」不再执行，只留作当时的定稿记录。现行依据是 [DRAWIO_EMBED_PLAN.md](./DRAWIO_EMBED_PLAN.md)。大纲仍以框架 Markdown 为真相。

依据：星程拍板（类 draw.io：任意连线、自由拖位置/形状；布局+连线另存）；方案审核短评；美术画面要点；撰写全文。  
约束：lite / WebView2；~~不嵌 diagrams.net~~（**已废止**，见文首）；本刀不做文件增删路径级联同步。

---

## 1. 目标（本刀必须）

自研 SVG 画布（增量于现有导图气质）：

1. 自由拖节点位置；三种形状：`round`（默认）/ `rect` / `ellipse`
2. 手画任意连线（`kind: "link"`）增删；**树边只读**，由 md 父子派生，不可拖断改父子
3. 读写旁路 `foo.md` ↔ `foo.canvas.json`；无 json / 坏 json → 树布局兜底，并在首次有效编辑后写入
4. 稳定节点 id（见 §4）；大纲 ↔ 画布高亮对齐（`highlightLine` / 选中）
5. 删关联笔记仍走 `trash` 语义（既有 `removeNode` / `notes.delete`）；**单击画布节点不自动建文件**

## 2. 明确不做（本刀 / 下一刀）

| 本刀不要 | 下一刀 |
| --- | --- |
| 嵌 diagrams.net / 完整 draw.io | 画布增删节点 ↔ 笔记文件增删同步 |
| 拖拽 rename 路径 | 框架 md rename 时级联 `.canvas.json` |
| 画布一点新建文件 | 力导向 / 虚拟化 |
| 推倒 md 大纲真相 | 曲线边（本刀直线/折线） |

## 3. 真相源与存盘

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 大纲真相 | `*.md`（`type: framework`） | 标题、列表层级、掌握度、wikilink、正文 |
| 画布旁路 | 同目录 `同名.canvas.json` | `viewport`、节点位置/尺寸/形状、自由边 |

- 树边：运行时由 `FrameworkTree` 父子推导，**不写入** json。
- 自由边：只活在 json（`kind: "link"`）。
- `version` 字段；解析失败 → 当作无文件，降级纯树布局（不写坏文件，等用户操作后再写好文件）。

路径规则：`50-frameworks/foo.md` → `50-frameworks/foo.canvas.json`（`stripExt` + `.canvas.json`）。

仿 sidecar：现有 `.yan/folders.json`（version + 宽容 normalize）同模式。

## 4. 稳定节点 id（本轮必须定）

现状（将改）：`fnv1a(path|line|text)` —— 行号进 id，插删行即漂。

新规则（`buildTree`）：

1. **有独立笔记**（`target.kind === 'file'` 且 path ≠ 框架自身）→ `id = "note:" + resolvedPath`
2. **否则** → `id = fnv1a(frameworkPath + "|" + parent.id + "|" + text + "|" + sameTextSiblingIndex)`  
   - 忌纯行号；同父同名用 sibling index 消歧
3. 根：保持 `fnv1a(path + "|root")`

**Reconcile（打开画布时）**

- md 有、json 无 → 补默认位（树布局）
- json 有、md 无 → **幽灵节点**（失效样式），可「清理」只改 json；**不自动改 md**
- 自由边端点失效 → 边标失效，清理时一并去掉

## 5. JSON Schema（version 1）

```json
{
  "version": 1,
  "mode": "bound",
  "frameworkPath": "50-frameworks/foo.md",
  "viewport": { "k": 1, "tx": 0, "ty": 0 },
  "nodes": [
    {
      "id": "note:50-frameworks/nodes/bar.md",
      "x": 120,
      "y": 80,
      "w": 208,
      "h": 34,
      "shape": "round"
    }
  ],
  "edges": [
    {
      "id": "e_ab12",
      "kind": "link",
      "from": "<nodeId>",
      "to": "<nodeId>",
      "arrow": false
    }
  ]
}
```

字段约定：

- `shape`: `"round" | "rect" | "ellipse"`；缺省 `round`
- `edges[].kind`: 仅 `"link"`（本刀）；树边不出现在数组
- `arrow`: 可选；true 时极淡小三角
- 忽略未知字段；非法 shape/edge 丢弃

## 6. 画面（美术定稿）

1. 形状仅 3：圆角矩形（默认）、矩形、椭圆
2. 选中：1px 低对比灰框 + 四角 6–8px 小方柄；**勿**彩色粗边 / 重投影
3. 连线把手：边中点小圆，悬停显；拖出细灰线；落点半级灰高亮
4. 线：本刀直线或正交折线；1px；箭头可选极淡小三角；曲线后补
5. 工具栏（顶或底窄条，单色线图标）：选择｜矩形｜圆角矩形｜椭圆｜连线｜删除（另保留缩放/适应）
6. 全走现有灰阶 token（`--border` / `--mm-link` / `--text-dim` 等），不新增强调色

## 7. API 清单（本刀新增 / 既有）

### 既有 FrameworkService（大纲仍改 md）

| 方法 | 作用 |
| --- | --- |
| `tree(rel)` | 解析大纲 → `FrameworkTree` |
| `setState` / `addNode` / `renameNode` / `removeNode` / `shiftNode` / `expandNode` | 增删改层级与掌握度；`removeNode` 默认可 `trashLinked` |

HTTP：`GET /api/v1/framework`，`POST .../state|add|rename|remove|shift|expand`

### 既有笔记

| 方法 | 作用 |
| --- | --- |
| `notes.delete({ mode: 'trash' })` | → `.yan/trash/...` |
| `notes.rename` / `restore` / `listTrash` / `clearTrash` | 移动/回收站 |

### 本刀新增

| 方法 | 作用 |
| --- | --- |
| `framework.getCanvas(path)` | 读旁路；坏/无 → `{ degraded: true, doc: null }` |
| `framework.saveCanvas(path, doc)` | 校验 version 后写入同目录 `.canvas.json` |

客户端 / HTTP / IPC / desktop `app-main` 同步挂载。

## 8. 前端切片

- 新建 `apps/web/src/components/FrameworkCanvas.tsx`（或等价增量）；`Framework` 导图模式改用它
- 加载：tree + getCanvas → reconcile → 渲染
- 交互：拖位置、改 shape、link 增删、选中柄、工具栏；**防抖写盘 ~400ms**
- 单击：选中 + `onNavigate`（不建文件）；双击：折叠（沿用）
- 大纲仍是 CRUD 入口

## 9. 依赖与实现选型

`package.json`：**无** `@xyflow/react` / reactflow；已有 `d3-hierarchy`（树布局兜底）+ 自研 SVG（`MindMap.tsx`）。

| 方案 | 利 | 弊（lite WebView2） |
| --- | --- | --- |
| 继续 SVG 自研 | 零新依赖、包体小、控 token | 连线/柄需自写 |
| `@xyflow/react` | 柄/边现成 | 体积与 API 面；lite 不划算 |

**本刀结论：继续 SVG 自研**，用 `d3-hierarchy` 仅作无 json 时的初始落位。

> 2026-10-28：此结论已废止。主画布改为整页嵌入 draw.io，见 [DRAWIO_EMBED_PLAN.md](./DRAWIO_EMBED_PLAN.md)。

## 10. 验收（审核 7 条为主）

1. 拖位置后重开仍在（json 旁路）
2. 自由边进入 json，且 **不改** md 树行
3. 无 json / 坏 json 可降级树布局，不白屏
4. 掌握度仍随 md（`setState`）
5. 删带笔记节点仍 trash（不静默硬删）
6. 大纲 ↔ 画布高亮/选中对齐
7. `npm run check` + `npm run build:lite` → `E:\Flyleaf`

画面可勾：3 形、灰阶选中框+角柄、边中点把手、工具栏六项。

## 11. 关键路径（调研）

| 路径 | 角色 |
| --- | --- |
| `core/src/app/framework-service.ts` | 大纲 CRUD |
| `core/src/domain/tree.ts` / `outline.ts` / `hash.ts` | 树与 id |
| `core/src/contracts.ts` | `TreeNode` / `FrameworkTree` / `YanClient` |
| `core/src/domain/folders.ts` | sidecar 先例 `.yan/folders.json` |
| `core/src/app/note-service.ts` | trash / rename |
| `core/src/app/templates.ts` | `.yan/*`、`50-frameworks` |
| `apps/web/src/components/MindMap.tsx` | 现 SVG 导图 |
| `apps/web/src/components/Framework.tsx` | 大纲+导图壳 |
| `docs/FRAMEWORK_PLAN.md` | 旧打磨方案（曾「不做自由白板」；本定稿覆盖画布范围） |

## 12. 实现顺序

1. 定稿本文 → 改 `buildTree` id → `domain/canvas.ts` + service/API
2. `FrameworkCanvas.tsx` + CSS + 接入 `Framework`
3. 单测（parse/reconcile/id）→ check → build:lite → VERIFY → commit

## 13. 纯梳理画布 / 随记入口（mode 切割）

### 两种 mode

| | `mode: "bound"`（本刀） | `mode: "scratch"`（下一刀） |
| --- | --- | --- |
| 用途 | 框架笔记自由布局/连线 | 只梳理知识结构，不绑笔记文件 |
| 主文件 | 框架 `foo.md`（大纲真相） | **无**框架 md；不写进 inbox 正文 |
| 旁路/本体 | 同目录 `foo.canvas.json` | **钉死** `.yan/scratch/<id>.flycanvas.json` |
| 节点 | 对应 md 树节点 id；可有 `note:` 前缀 | 仅标题文本；`notePath` 可空；**禁止**自动建/删/改笔记 |
| 树边 | md 父子派生，只读 | 无 md 树；结构边也可只活在 json（下一刀定） |
| 删除 | 大纲删节点仍可 trash 关联笔记 | 删 scratch **只动画布文件**，不走笔记 trash |
| 入口 | 框架笔记 → 导图 | 知识框架区区分入口 + **随记「开梳理画布」** |

### Schema（本刀必须留字段）

```json
{
  "version": 1,
  "mode": "bound",
  "frameworkPath": "50-frameworks/foo.md",
  "viewport": { "k": 1, "tx": 0, "ty": 0 },
  "nodes": [],
  "edges": []
}
```

- `mode`：**必填语义**；缺省读入时按 `bound`（旁路在 md 旁）兼容；新写入一律显式写出。
- scratch 文件可省略 `frameworkPath` 或置空；用 `title` 字段（下一刀加）显示名。
- **同一套** `FrameworkCanvas` 组件：按 `mode` 开关「是否 reconcile md 树 / 是否允许点出笔记」。

### 本刀 vs 下一刀

1. **本刀**：`bound` 自由画布 + `foo.canvas.json` + schema 含 `mode`；组件可复用；**不**做 scratch 入口。
2. **下一刀（本刀已落地）**：`scratch` 存盘、随记「开梳理画布」、侧栏列表；删 scratch 不碰笔记。

### scratch 存盘约定（已钉）

- 路径：`.yan/scratch/<id>.flycanvas.json`（与 capture 草稿 `card.json` 同目录、后缀区分）
- `mode: "scratch"`；`frameworkPath` 空；`title` 显示名；节点带 `text`
- API：`listScratch` / `createScratch` / `getScratch` / `saveScratch` / `deleteScratch`（delete 只 `repo.remove` 画布文件）
- UI：同一 `FrameworkCanvas`（`mode="scratch"`）；随记卡「开梳理画布」；侧栏「梳理画布」列表

### 验收补充

- bound：拖/连线/改形不新建笔记；单击不建文件。
- scratch：全程不碰笔记文件增删路径；删画布只去 `.flycanvas.json`。

