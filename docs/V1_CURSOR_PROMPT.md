# Flyleaf v1 — Cursor Agent 任务书（本机改码）

你在本机仓库工作：`C:\Users\ADMIN\Documents\deepseek-harness\default-workspace\yan`
安装刷写目标：`E:\Flyleaf`（`npm run build:lite`）
真库：`E:\Notes`（环境变量 `FLYLEAF_VAULT`）
产品约束：lite WebView2 为主；不做同步站点；不以 Electron 大包为主线；不做整仓架构重写，但要**模块化、解耦、可扩展**地演进到可安装的完整 v1。

## 用户原话要点
1. 随记/收件箱文件夹删不掉
2. 没法单独删除单个笔记文件
3. 功能与体验仍有不少缺陷 → 评估完善到完整 v1
4. 可在其他电脑安装使用
5. 注意模块化解耦与可扩展
6. 进一步优化界面与排版舒适度

## 必须先做（P0）

### A. 删除单个笔记
- 现状：`fs-note-repo.remove` 有实现，但 `contracts` / `note-service` / HTTP/IPC / Host / UI **没有**对外 `notes.delete`
- 目标：
  - 契约增加 `DeleteNoteInput` + `notes.delete(path)`（建议移入回收站或直接 unlink，优先：先 unlink + 索引移除；若已有 `.yan/trash` 则用 trash）
  - 打通 `note-service`、`host`、`http`、`ipc`、lite Host.cs 若需要
  - UI：侧栏文件右键「删除」、选中文件时 `Delete`/`Backspace`（有确认）、打开中的笔记被删后清空编辑器并刷新树
  - 删除失败给出中文 status

### B. 收件箱/随记文件夹可删
- 现状：`canDeleteFolder` 在 `isInbox` 时永远拒绝（「请先改 inbox 再删」），UI 又没有「改设收件箱」入口，所以用户体感是「随记永远删不掉」
- 目标：
  - UI：文件夹管理里可「设为收件箱」
  - 删除当前 inbox 时：若还有其他用户文件夹，自动把 inbox 改到第一个其他文件夹并允许删除；若只剩这一个，拒绝并说明
  - `assets` / `.yan` 仍不可删
  - 非空默认 refuse；提供「连同内容删除」二次确认（已有 recursive 路径可复用）

### C. 验收命令（每批必跑）
```
npm run check
npm run build:lite
```
确认 `E:\Flyleaf` 已更新。用白话列出改动文件与手测步骤。

## P1 — 可移植安装（其他电脑可用）
- 在 `scripts/` 增加 `pack:portable`（或扩展 `build-lite.mjs`）：产出 zip/目录包，内含：
  - lite 可执行与 web 资源
  - 首次运行说明（README-PORTABLE.md）：如何选笔记库目录、如何设 `FLYLEAF_VAULT`（或首次弹窗选库，若 Host 已支持则接上）
- 目标：拷到另一台 Windows（需 WebView2）解压即可跑；不依赖本机绝对路径写死
- 检查 Host/启动逻辑里硬编码 `E:\Notes` / `E:\Flyleaf` 的地方，改为可配置

## P2 — 模块化与边界（渐进，不重写）
- 保持现有 workspaces：`core` / `ui` / `apps/*`
- 删除/文件夹/笔记 CRUD 逻辑留在 `core` domain+app；UI 只调契约
- 若 `App.tsx` 过大：可拆 `SidebarFolders`、`NoteTree`、删除确认等小组件到 `apps/web/src/`，但**不要**大挪目录或换框架
- `npm run check:boundaries` 必须继续通过

## P3 — 界面与排版舒适度
- 在现有黑白柔和双主题 + tokens 上微调，不另起主题体系
- 侧栏间距、树节点行高、空状态、危险操作（删除）的视觉层级再顺一点
- 尊重 `prefers-reduced-motion`

## 明确不要做
- 云同步 / 多端账号
- 以 Electron 安装包替换 lite 成为主交付
- 整仓重写、换状态管理库、换编辑器内核
- 动公司 Figurine / IronExile 工程

## 建议实现顺序
1. notes.delete 全链路 + UI
2. setInbox + 删 inbox 自动迁移
3. pack:portable + 去硬编码路径
4. App 小组件拆分 + 侧栏舒适度微调
5. check + build:lite，写简短交付说明

## 成功标准
- 能删单个 `.md`；能删非系统文件夹；能在改设/自动迁移后删掉原收件箱
- `npm run check` 与 `build:lite` 通过，安装目录可更新
- 有可拷贝的便携包或清晰打包脚本
- 边界检查通过；无大范围无关 diff

开始前先快速扫 `core/src/domain/folders.ts`、`vault-service.ts`、`note-service.ts`、`apps/web/src/App.tsx`、`shell/lite`，再动手。每完成一块用中文简报进度。
