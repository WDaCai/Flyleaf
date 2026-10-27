# UX v1.1 验收记录

日期：2026-10-28（Asia/Shanghai）  
范围：排版/视觉收口 + 回收站反馈/还原 + 空状态三件套 + 危险确认 + Focus/读宽/命令面板

## 自动化

- [x] `npm run check`（typecheck + boundaries + vitest 61 passed，含 trash.test）
- [x] `npm run build:lite` → `E:\Flyleaf`（已刷入）

## 手测清单（实现已对齐，需在安装目录点验）

1. **打开 → 编辑 → 移分类 → 删 → status**
   - 正文 token：`--font-size-body: 15px`、`--leading-body: 1.7`；读宽三档 680/820/960（`data-editor-width`）
   - 右键移动分类；删除进回收站轻确认后 status/toast「已移入回收站」，toast 提供「撤销」
2. **Focus**
   - `Ctrl+\`、顶栏 Focus、命令面板切换；`.app.focus-mode` 藏左右栏
   - `prefers-reduced-motion` 下 toast/侧栏无猛动画
3. **还原**
   - 侧栏「回收站」列最近项 →「还原」；命令「还原最近删除」；路径丢失回退 inbox
4. **空状态三套**
   - 无笔记：主区「还没有笔记」+「新建笔记」
   - 空文件夹：树内「此文件夹是空的」+「在此新建」
   - 空回收站：面板「回收站是空的」+「返回笔记」
5. **危险确认**
   - 进回收站：一次轻确认
   - 清空回收站 / 永久删除：说明不可恢复
   - 非空文件夹：二次确认说明后果
6. **主题 / 侧栏**
   - 浅暖纸 / 深冷灰；树选中 `.tree-row.on` 浅底+字重；inbox 角标；树间距略松（depth×14、row 30px）
   - 少阴影、1px `--border` / `--border-soft`

## 本轮代码要点

- core：`notes.clearTrash`；允许对 `.yan/trash/**` hard delete；`listTrash` / `restore` 既有
- web：Focus、读宽、toast 撤销、回收站面板、空状态三套、命令面板补齐
- 未做：同步/云、架构重写、换编辑器、图谱看板、无 trash 硬删默认路径

## 结果

check ✅ · build:lite ✅ · 已提交本地（见 git log）
