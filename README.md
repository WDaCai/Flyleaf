# 砚 · Yan

本地优先的个人技术工作台：踩坑、性能实验、周复盘、知识树，外加一张能悬浮在屏幕上的随手记卡片。数据是纯 Markdown，随时可以扔回 Obsidian。

## 现在能做什么（v0.2）

- 打开任意文件夹作为 vault，文件树导航
- Markdown 编辑（CodeMirror）、分栏预览、自动保存（无 Ctrl+S）
- 中文全文搜索，支持 `type:` `tag:` `project:` `nodes:` 过滤
- `[[双链]]` 与反向链接面板
- 知识框架：大纲 / **导图** 双视图，四档掌握度、进度条、节点展开成独立文件
- **实验对比图**：自动解析正文第一张表，按指标分组画 before/after 柱状图（每个指标单独归一，避免量级差掩盖小值）
- **属性面板**：项目 / 引擎 / 平台 / 标签 / 关联节点，失焦即存，空值自动清理字段
- **呈现模式**：`Ctrl+Shift+P` 切浅色排版，一键复制为图片或打印成 PDF
- 命令行面板（Ctrl+P）、全文搜索面板（Ctrl+Shift+F）
- 悬浮随记卡：置顶、全局热键、草稿随输随存、Ctrl+Enter 归档到当日 inbox

## 跑起来

```powershell
npm install

# 1) 生成演示 vault（只清空 .local-vault，安全）
node scripts/seed-demo.mjs

# 2) 一起启动 API + 前端
npm run dev
#   前端 http://localhost:5173
#   接口 http://127.0.0.1:5174
```

单独启动：

```powershell
npm run dev:server            # 默认 .local-vault
npm run dev:server -- D:\我的库  # 指定 vault
npm run dev:web
```

桌面壳（含悬浮卡）：

```powershell
npm run build:desktop
npm run dev:desktop
```

> 桌面壳默认打开 `%USERPROFILE%\Documents\yan-vault`，可用环境变量 `YAN_VAULT` 覆盖。
> 若 Electron 二进制下载失败，设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后执行 `npm rebuild electron`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm test` | domain 单元测试（44 条） |
| `npm run typecheck` | 全量类型检查 |
| `npm run check:boundaries` | 分层边界门禁 |
| `npm run check` | 以上三件一起跑 |
| `node scripts/api-smoke.mjs` | 接口冒烟（需先起 server） |
| `node scripts/shots.mjs` | 无头 Chrome 截图到 `shots/` |

## 键位

| 操作 | 键位 |
|---|---|
| 命令面板 | `Ctrl+P` |
| 搜索面板 | `Ctrl+Shift+F` |
| 切换编辑/预览 | `Ctrl+E` |
| 大纲/导图切换 | `Ctrl+M` |
| 呈现模式 | `Ctrl+Shift+P` |
| 唤起悬浮卡（桌面） | `Ctrl+Alt+Space` |
| 卡片归档 | `Ctrl+Enter` |

## 目录结构

```
core/src/
  contracts.ts     跨层类型契约（浏览器可直接引用）
  domain/          纯函数：frontmatter / outline / 状态 / 双链 / 树 / 搜索 / 随记格式
  ports/           接口定义（依赖倒置的接缝）
  app/             用例：Note / Framework / Capture / Search / Asset / Vault
  infra/           fs / 内存索引 / chokidar / JSON 配置 / 每日 inbox
  api/             Fastify 路由（web 壳用）
  client/          HTTP 与 IPC 两个传输，返回同一个 YanClient
  host.ts          当前 vault 的持有者，两个壳共用
  core.ts          唯一装配点
apps/web/          Vite + React 主界面
apps/desktop/      Electron 主进程 + 主窗口 + 悬浮卡
ui/                设计 token 与共享常量
```

**依赖方向**：shell → api/client → app → domain；infra 实现 ports。`domain` 零依赖，`app` 不碰 IO。这条规则由 `npm run check:boundaries` 强制。

## 还没做

- 桌面壳的真机验证（见下）
- 导图在 500 节点以上的虚拟化
- Electron 内的 `printToPDF`（目前走系统打印对话框）

## 已知限制

- Electron 在无交互桌面的会话里无法创建窗口（本仓库的 CI 环境即如此），桌面壳代码已构建通过但需在你本机手动验证。
- 呈现模式导出图片优先写剪贴板，浏览器拒绝时会自动改为下载 PNG。
- 编辑器只编辑正文，frontmatter 走右侧属性面板。
