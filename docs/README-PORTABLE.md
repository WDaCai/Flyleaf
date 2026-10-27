# Flyleaf 便携包说明

拷到任意 Windows 电脑（需已装 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)），解压后双击 `Flyleaf.exe` 即可。

## 笔记库路径（按优先级）

1. 环境变量 `FLYLEAF_VAULT`（或旧名 `YAN_VAULT`）
2. 与 `Flyleaf.exe` 同目录的 `vault.path` 文件（一行绝对路径，或相对 exe 的相对路径）
3. 默认：`文档\flyleaf-vault`

示例：把 `vault.path.example` 复制为 `vault.path`，改成你的库目录，例如：

```
E:\Notes
```

本机开发刷盘目录默认是 `E:\Flyleaf`（可用环境变量 `FLYLEAF_INSTALL` 改），与笔记库无关。

## 依赖

- Windows 10/11 x64
- 系统 WebView2（多数 Win11 已自带）
- 同目录需要有 `node.exe`（若打包时未附带，请自行放入；启动失败会提示）

## 回收站

删除笔记默认移入库内 `.yan/trash/`，不是系统回收站。可手动挪回原路径恢复。

## 不包含

云同步、多端账号、Electron 安装包。