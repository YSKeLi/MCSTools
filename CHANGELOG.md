# Changelog

All notable changes to MCServerTools are documented in this file.

## v1.0.7

### 关键改动

- [PersistentProcessController.ts (line 29)](https://github.com/YSKeLi/MCSTools/blob/v1.0.7/src/main/runtime/PersistentProcessController.ts#L29)：托管状态记录并核对实际子进程可执行文件，兼容 Windows、Linux 和 macOS 的进程恢复。
- [configPolicy.ts (line 1)](https://github.com/YSKeLi/MCSTools/blob/v1.0.7/src/main/frp/configPolicy.ts#L1)：导入的 FRP 配置通过运行时副本启用持续重连，不修改用户原始配置文件。

### Bug 修复

- [PersistentProcessController.ts (line 202)](https://github.com/YSKeLi/MCSTools/blob/v1.0.7/src/main/runtime/PersistentProcessController.ts#L202)：修复 Windows 复用旧 PID 后把 `WidgetService.exe` 等其他程序误判为遗留 FRP 进程，导致无法再次启动的问题。
- [FrpManager.ts (line 334)](https://github.com/YSKeLi/MCSTools/blob/v1.0.7/src/main/frp/FrpManager.ts#L334)：设置 `loginFailExit = false`，修复 FRP 首次连接超时后直接退出、不再自动重试的问题。

## v1.0.6

### 关键改动

- [RemoteServerService.ts (line 2092)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/remote/RemoteServerService.ts#L2092)：新增云服务器一键部署，覆盖环境预检、本地下载、SFTP 上传校验、远程安装、原子提交和失败回滚。
- [RemoteServerDetailPage.tsx (line 327)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/renderer/pages/RemoteServerDetailPage.tsx#L327)：新增云服务器部署向导、预检结果、实时进度、任务取消和历史状态展示。
- [RemoteServerPage.tsx (line 157)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/renderer/pages/RemoteServerPage.tsx#L157)：新增 SSH 密码与私钥认证切换，支持加密私钥和可选口令。
- [deploymentArtifacts.ts (line 160)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/remote/deploymentArtifacts.ts#L160)：支持安全处理 JAR、Forge/NeoForge/Quilt 安装器、ZIP、TAR 和 Bedrock 原生服务端。
- [RemoteServerService.ts (line 1808)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/remote/RemoteServerService.ts#L1808)：部署任务持久化，应用异常退出后自动核对远端状态并清理或恢复任务。
- [core/index.ts (line 228)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/core/index.ts#L228)：统一服务端核心下载元数据，下载后执行文件大小与 SHA-256 校验，再上传至云服务器。

### Bug 修复

- [FrpPage.tsx (line 6)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/renderer/pages/FrpPage.tsx#L6)：FRP 日志历史与实时日志合并后只保留最近 500 行，修复日志窗口无限增长和重复内容问题。
- [archive.ts (line 5)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/frp/archive.ts#L5)：改用应用内 ZIP/TAR 解压能力，修复目标系统缺少 `tar` 命令时 FRP 无法安装的问题。
- [serverStorePolicy.ts (line 50)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/serverStorePolicy.ts#L50)：修复生产构建使用 `file://` 页面时旧版根路径核心图标无法显示的问题。
- [javaPolicy.ts (line 7)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/server/javaPolicy.ts#L7)：Minecraft 26.x 自动要求 Java 25，修复新版本服务端 Java 版本判断错误。
- [deploymentArtifacts.ts (line 130)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/remote/deploymentArtifacts.ts#L130)：旧版 Forge 多 JAR 目录优先选择 `universal.jar`，避免启动到错误文件。
- [RemoteServerService.ts (line 85)](https://github.com/YSKeLi/MCSTools/blob/v1.0.6/src/main/remote/RemoteServerService.ts#L85)：为 SFTP 操作和上传停滞增加超时，避免网络异常时部署任务永久挂起。

## v1.0.5

- 应该修复了CPU资源占用过高的问题
- 重构了UI，使其更美观和易懂
- 新增了在线玩家列表选项
- 更完善的设置页面
- 完善云服务器管理
- 更新了一堆bug

## v1.0.4

- 新增云服务器管理。
- 新增本地设备信息监控。
- 新增 Java 管理与 Java 21 下载。
- 支持自动匹配系统和安装包。
- 支持为服务器单独配置 Java。
- 重构 FRP 配置导入与切换。
- 优化 FRP 下载和启动流程。
- 完善软件检查更新与自动安装。
- 优化文件下载稳定性。
- 修复服务器启动和进程控制问题。
