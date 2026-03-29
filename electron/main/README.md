# main/

Electron 主进程目录，负责窗口管理、IPC、录音流程、ASR/文本润色调用与文本注入。

## 文件列表

- `main.ts` - 应用入口；创建后台/设置/浮窗窗口、托盘菜单与 IPC 处理，协调 PTT 录音 → 转录 → 文本润色 → 注入流程、会话取消与 FFmpeg 初始化，并向音频处理器注入 ASR/润色服务（系统语言随窗口聚焦同步，开机自启时静默后台启动，手动启动时打开设置页）。
- `i18n.ts` - 主进程 i18next 初始化与语言切换，广播语言快照到各窗口。
- `env.ts` - 运行时环境与资源路径解析（开发/生产）。
- `config-manager.ts` - 使用 `electron-store` 持久化应用偏好、ASR 配置、文本润色配置与快捷键配置。
- `logger.ts` - 初始化 `electron-log`，统一控制台写入与日志保留/轮转策略。
- `history-manager.ts` - 录音历史存储（固定保留最近 90 天），提供增删清空与统计接口。
- `hotkey-manager.ts` - 基于 `globalShortcut` 的全局快捷键注册/注销。
- `iohook-manager.ts` - 基于 `uiohook-napi` 的键盘钩子，检测 PTT 组合键按住状态。
- `asr-provider.ts` - 调用 GLM ASR API（axios + FormData）上传音频并返回转录结果。
- `refine/` - 文本润色模块；将手动填写的 OpenAI-compatible 配置解析成统一 Chat Completions 请求，并执行润色与连接测试。
- `text-injector.ts` - 基于 `@nut-tree-fork/nut-js` 注入文本；Windows 使用剪贴板粘贴，macOS 校验辅助功能权限。
- `updater-manager.ts` - 调用 GitHub Releases API 检查新版本，缓存结果并打开发布页下载链接。
- `audio/` - 录音会话、音频转换与转写处理流水线。
- `hotkey/` - 快捷键解析与 PTT 行为绑定。
- `tray/` - 托盘菜单与本地化刷新。
- `window/` - 背景、设置与浮窗窗口管理。
- `notification/` - 系统通知封装。
- `ipc/` - IPC 处理器模块（配置、会话、历史、日志、更新、浮窗）。
- `__tests__/` - 主进程模块测试（config-manager 等）。
