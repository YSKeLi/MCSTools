<p align="center">
  <img src="public/icons/app-icon.png" width="128" height="128" alt="MCServerTools">
</p>

<h1 align="center">MCServerTools</h1>

<p align="center">
  跨平台 Minecraft 服务器搭建工具
</p>

<p align="center">
  <i>"化繁为简，让每一位服主都能专注于游戏本身的纯粹。"</i>
</p>

<p align="center">
  <a href="https://github.com/YSKeLi/MCSTools/releases"><img src="https://img.shields.io/github/v/release/YSKeLi/MCSTools?color=brightgreen&label=version" alt="Version"></a>
  <a href="https://github.com/YSKeLi/MCSTools"><img src="https://img.shields.io/badge/language-React%20%7C%20Electron-blueviolet" alt="Language"></a>
  <a href="https://github.com/YSKeLi/MCSTools"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform"></a>
  <a href="https://github.com/YSKeLi/MCSTools/issues"><img src="https://img.shields.io/github/issues/YSKeLi/MCSTools?color=orange" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/YSKeLi/MCSTools?color=yellow" alt="License"></a>
  <a href="https://github.com/YSKeLi/MCSTools"><img src="https://img.shields.io/github/stars/YSKeLi/MCSTools?style=social" alt="Stars"></a>
</p>

> **注意：** 目前 MCServerTools 处于开发完善阶段，可能存在部分 BUG，欢迎通过 Issues 提交反馈。

---

## 目录

- [主要特点](#主要特点)
- [支持系统](#支持系统)
- [快速上手](#快速上手)
- [常见问题](#常见问题)
- [支持的核心](#支持核心)
- [项目结构](#项目结构)
- [社区与支持](#社区与支持)
- [鸣谢](#鸣谢)
- [协议与免责声明](#协议与免责声明)

---

## 主要特点

- **一键部署**：选择核心 → 选择版本 → 自动下载 → 开箱即用
- **多核心支持**：内置 10 种核心（Vanilla / Paper / Purpur / Forge / Fabric / NeoForge / Sponge / Mohist / CraftBukkit / Spigot）
- **配置管理**：图形化修改 `server.properties`，提供全中文标注，无需手动查阅文档
- **内网穿透**：内置 frp 客户端，一键将本地服务器端口暴露到公网
- **现代 UI**：采用 Material Design 设计规范，注重界面的丝滑过渡与高质感细节，支持浅色与深色主题无缝切换

---

## 支持系统

- **Windows 10+** (支持架构：AMD64 / ARM64)
- **macOS** (支持架构：Intel / Apple Silicon)
- **Linux** (支持架构：AMD64 / ARM64)

---

## 快速上手

获取源码并启动开发环境：

```bash
git clone https://github.com/YSKeLi/MCSTools.git
cd MCServerTools
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
```

---

## 常见问题

### macOS 提示无法打开或“已损坏”

由于应用未经过 Apple 官方签名，首次打开时可能出现以下提示：

- “无法打开‘MCServerTools’，因为无法验证开发者。”
- “‘MCServerTools’ 已损坏，无法打开。您应该将它移到废纸篓。”

这并不是应用真的损坏，而是 macOS 的 Gatekeeper 安全机制拦截。请按以下步骤解决：

1. **首次启动（推荐）**  
   在访达中右键（或按住 Control 键再点击）应用图标，选择「打开」，然后在弹出的对话框中再次点击「打开」即可。

2. **如果仍然无法打开**  
   打开「终端」应用，执行以下命令移除隔离属性（请将路径替换为你的实际位置，例如拖入应用图标即可自动填入路径）：
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/MCServerTools.app
   ```

3. **如果提示 “Apple 无法检查是否包含恶意软件” 且没有「打开」按钮**  
   进入「系统设置」→「隐私与安全性」，在页面底部找到关于 MCServerTools 的被拦截记录，点击「仍要打开」进行确认。

完成后即可正常使用，后续版本更新也只需重复一次上述操作。

---

### 如何在 Linux 下运行 AppImage 文件

我们为 Linux 提供了 `.AppImage` 格式的发行包，无需安装，开箱即用。使用方法如下：

1. **赋予可执行权限**  
   右键点击 `.AppImage` 文件 →「属性」→「权限」→ 勾选「允许作为程序执行」。  
   或者打开终端，切换到文件所在目录，执行：
   ```bash
   chmod +x ./MCServerTools-x.x.x.AppImage
   ```

2. **运行应用**  
   双击文件即可运行，或在终端中执行：
   ```bash
   ./MCServerTools-x.x.x.AppImage
   ```

3. **（可选）集成到桌面环境**  
   若希望像普通应用一样从启动器打开，可以手动创建 `~/.local/share/applications/mcservertools.desktop` 文件，内容如下（请将 `Exec` 和 `Icon` 的路径替换为实际路径）：
   ```ini
   [Desktop Entry]
   Name=MCServerTools
   Comment=Minecraft 服务器搭建工具
   Exec=/home/你的用户名/Applications/MCServerTools-x.x.x.AppImage
   Icon=/home/你的用户名/.local/share/icons/mcservertools.png
   Type=Application
   Categories=Utility;
   Terminal=false
   ```
   保存后，桌面环境会自动识别并出现在应用菜单中。

---

## 支持核心

- <img src="public/icons/vanilla.ico" width="20" height="20"> **Vanilla**：最纯净的原版体验
- <img src="public/icons/paper.ico" width="20" height="20"> **Paper**：高性能 Bukkit 服务端
- <img src="public/icons/purpur.ico" width="20" height="20"> **Purpur**：更多自定义配置
- <img src="public/icons/craftbukkit.ico" width="20" height="20"> **CraftBukkit**：最早的 Bukkit 实现
- <img src="public/icons/spigot.svg" width="20" height="20"> **Spigot**：CraftBukkit 优化版
- <img src="public/icons/forge.ico" width="20" height="20"> **Forge**：最流行的 Mod 加载器
- <img src="public/icons/fabric.svg" width="20" height="20"> **Fabric**：轻量级 Mod 加载器
- <img src="public/icons/neoforge.ico" width="20" height="20"> **NeoForge**：Forge 的下一代分支
- <img src="public/icons/sponge.ico" width="20" height="20"> **Sponge**：全新架构 Mod API
- <img src="public/icons/mohist.png" width="20" height="20"> **Mohist**：Mod + 插件混合核心


---

## 项目结构

```text
MCServerTools/
├── src/
│   ├── main/          # Electron 主进程代码
│   ├── renderer/      # React 前端代码 (Material UI)
│   └── shared/        # 共享的类型定义与工具方法
├── public/icons/      # 核心图标与静态资源
├── scripts/           # 辅助工具与构建脚本
├── dist/              # 编译打包输出目录
└── package.json       # 项目配置文件与依赖管理
```

---

## 社区与支持

如果在安装或使用过程中遇到任何问题，或者有新的功能建议，欢迎随时交流：

- **提交 Issue**：[GitHub Issues 页面](https://github.com/YSKeLi/MCSTools/issues)
- **获取最新版本**：[GitHub Releases 页面](https://github.com/YSKeLi/MCSTools/releases)

---

## 鸣谢

MCServerTools 的诞生离不开以下优秀的开源项目与社区生态：

- **frp**：提供稳定高效的内网穿透反向代理支持。
- **PaperMC / Purpur / Fabric 等开源社区**：为工具提供了可靠的服务端 API 数据源。
- **Material UI**：为本工具的前端界面提供了高质量的组件库支持。

---

## 协议与免责声明

本项目采用 **MIT License** 开源协议，您可以自由地使用、修改和分发本项目代码，但需保留完整的版权声明和免责声明。

**合规注意**：
- 使用本工具下载和运行 Minecraft 服务端即表示您同意并遵守 Mojang 的 [最终用户许可协议 (EULA)](https://account.mojang.com/documents/minecraft_eula)。
- 本项目仅提供纯粹的技术聚合与自动化下载服务，不对任何通过本工具架设的服务器内产生的内容或纠纷负责。
