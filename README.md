<p align="center">
  <img src="public/icons/app-icon.png" width="128" height="128" alt="MCServerTools">
</p>

<h1 align="center">MCServerTools</h1>

<p align="center">跨平台 Minecraft 服务器管理工具</p>

<p align="center">
  <a href="https://github.com/YSKeLi/MCSTools/releases"><img src="https://img.shields.io/github/v/release/YSKeLi/MCSTools?color=brightgreen&label=version" alt="Version"></a>
  <a href="https://github.com/YSKeLi/MCSTools"><img src="https://img.shields.io/badge/React-Electron-blue" alt="Technology"></a>
  <a href="https://github.com/YSKeLi/MCSTools"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform"></a>
  <a href="https://github.com/YSKeLi/MCSTools/issues"><img src="https://img.shields.io/github/issues/YSKeLi/MCSTools?color=orange" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/YSKeLi/MCSTools?color=yellow" alt="License"></a>
</p>

> 当前项目仍在持续完善中。如果遇到问题，请附上复现步骤和相关日志提交 Issue。

---

## 目录

- [功能](#功能)
- [下载安装](#下载安装)
- [支持平台](#支持平台)
- [快速开始](#快速开始)
- [远程服务器](#远程服务器)
- [FRP 穿透](#frp-穿透)
- [开发与构建](#开发与构建)
- [常见问题](#常见问题)
- [支持的核心](#支持的核心)
- [项目结构](#项目结构)
- [协议与免责声明](#协议与免责声明)

---

## 功能

- **核心下载**：通过 [MSL 开服器](https://www.mslmc.cn/) 提供的核心列表和下载服务，选择 Minecraft 服务端核心和版本并下载。
- **本地服务器管理**：添加多个本地服务器，启动、停止、强制停止和发送控制台命令。
- **服务器配置**：编辑 `server.properties`，为每个服务器设置内存和 Java 路径。
- **Java 管理**：检测本机 Java 环境，自动匹配系统和处理器架构，下载 Oracle Java 21 LTS。
- **本机监控**：查看本机 CPU、内存和硬盘使用情况。
- **云服务器管理（实验性）**：通过 SSH 连接 Windows Server 或 Linux 服务器，查看系统资源和基本信息。
- **FRP 穿透**：导入、命名、切换和启动 FRP 配置文件。
- **软件更新**：检查新版本，自动匹配当前平台安装包，下载并校验后安装。
- **主题切换**：支持浅色和深色主题。

---

## 下载安装

普通用户请前往 [GitHub Releases](https://github.com/YSKeLi/MCSTools/releases) 下载对应平台的发行包。

| 平台 | 可用格式 |
| --- | --- |
| Windows | NSIS 安装包、MSI 安装包、ZIP 压缩包 |
| macOS | DMG、ZIP |
| Linux | AppImage、DEB、RPM |

Windows 和 macOS 发行包可能未经过商业代码签名。首次运行时，请根据系统安全提示确认是否打开应用。

Linux AppImage 可能需要先赋予执行权限：

```bash
chmod +x ./MCServerTools-Linux-x64.AppImage
./MCServerTools-Linux-x64.AppImage
```

---

## 支持平台

- Windows 10 及以上：AMD64、ARM64
- macOS：Intel、Apple Silicon
- Linux：AMD64、ARM64

Java 下载包和具体发行包会根据当前系统与处理器架构自动匹配；如果 Oracle 没有提供对应平台的安装包，Java 管理页面会提示前往官方页面确认。

---

## 快速开始

1. 打开“核心选择”，选择核心、版本和服务器目录。
2. 下载完成后，在“本地服务器管理”中添加该目录。
3. 确认 Java 环境和服务器内存配置。
4. 启动服务器并在控制台中查看运行日志。

服务器启动前，程序会检查所需 Java 版本。未检测到合适版本时，请打开“Java 管理”安装 Java 21，或在服务器配置中选择已有的 Java 可执行文件。

启动 Minecraft 服务端会写入 `eula.txt` 中的 `eula=true`。使用前请阅读并接受 [Minecraft EULA](https://www.minecraft.net/en-us/eula) 及相关条款。

---

## 远程服务器

云服务器管理目前处于实验性开发阶段，属于半成品功能。当前支持通过 SSH 添加 Windows Server 或 Linux 服务器，并查看 CPU、内存、硬盘和基本系统信息；暂不支持远程开关机、远程文件管理、远程控制台和 SSH 密钥登录。功能和连接方式后续可能调整。

远程服务器使用 SSH 连接，不需要安装 MCServerTools 客户端。

### Windows Server

- 远程服务器需要运行 OpenSSH Server。
- 需要使用 Windows 账户密码登录，Windows Hello PIN 不能用于 SSH 登录。
- 指标采集使用 PowerShell 和 CIM 查询。

### Linux

- 远程服务器需要运行 SSH Server。
- 指标采集使用远程 Shell 和标准 Linux 系统文件。

添加服务器时，程序会先读取 SSH 主机指纹。确认指纹后才会保存连接信息。密码使用系统安全存储加密保存，不会上传到第三方服务。

---

## FRP 穿透

在“FRP 设置”中导入已有的 `.toml`、`.ini` 或 `.conf` 配置文件，并为配置设置名称。之后可以从列表中选择配置、启动或删除配置记录。

首次启动时，程序会自动下载匹配平台的 `frpc`，并优先保存到应用目录下的 `runtime/frp`。下载文件会进行完整性校验，运行日志会显示在 FRP 页面中。

---

## 开发与构建

### 开发环境

需要安装 Node.js 和 npm：

```bash
git clone https://github.com/YSKeLi/MCSTools.git
cd MCServerTools
npm install
npm run dev
```

### 常用命令

```bash
npm run typecheck   # 类型检查
npm test            # 构建主进程并运行测试
npm run build       # 构建主进程和渲染进程
npm run dist        # 构建完整发行包
```

Windows 构建命令：

```powershell
npm run dist:win
npm run dist:win:unsigned
```

构建产物默认输出到 `release/`。开发环境生成的主进程文件位于 `dist/`。

---

## 常见问题

### `npm run dev` 提示找不到 `package.json`

请确认当前终端目录是项目根目录，并且该目录下存在 `package.json`。复制文件夹时应复制完整项目目录，不要只复制构建产物或安装目录。

### Vite 提示端口 5173 已被占用

关闭占用 5173 端口的开发服务器，或结束对应的 Node.js 进程后再执行 `npm run dev`。

### 启动服务器提示 `spawn java ENOENT`

请打开“Java 管理”确认 Java 是否已检测到，或在服务器配置中手动选择 `java.exe`。服务器所需 Java 版本必须满足对应 Minecraft 版本要求。

### Windows 远程服务器 SSH 登录失败

确认远程 SSH 服务正在运行、22 端口可访问、账户已启用，并使用账户实际密码而不是 Windows Hello PIN。Windows 本地账户直接填写账户名即可。

### macOS 提示无法验证开发者

在访达中右键应用并选择“打开”。如果仍然无法启动，请在“系统设置”的“隐私与安全性”中允许打开该应用。

---

## 支持的核心

核心列表由在线数据源动态获取，当前包含以下核心类型：

- Vanilla
- Paper
- Purpur
- Forge
- Fabric
- NeoForge
- Sponge
- Mohist
- CraftBukkit
- Spigot

可用版本和下载地址以应用内实际显示为准。

---

## 项目结构

```text
MCServerTools/
├── src/main/       # Electron 主进程、服务器、Java、FRP、更新和远程连接逻辑
├── src/renderer/   # React + Material UI 界面
├── public/         # 图标和静态资源
├── scripts/        # 构建脚本
├── tests/          # 自动化测试
├── dist/           # 编译输出目录
└── package.json    # 项目配置和依赖管理
```

---

## 社区与支持

- [提交 Issue](https://github.com/YSKeLi/MCSTools/issues)
- [查看 Releases](https://github.com/YSKeLi/MCSTools/releases)

提交问题时，请附上系统版本、处理器架构、软件版本、复现步骤和错误日志。请不要公开密码、API Key、SSH 私钥或其他敏感信息。

---

## 鸣谢

- [MSL 开服器](https://www.mslmc.cn/)：提供 Minecraft 服务端核心列表、版本信息和下载镜像支持
- [frp](https://github.com/fatedier/frp)：内网穿透支持
- [PaperMC](https://papermc.io/)、[Purpur](https://purpurmc.org/)、[Fabric](https://fabricmc.net/) 等社区：服务端核心和生态支持
- [Material UI](https://mui.com/)：界面组件库
- [ssh2](https://github.com/mscdex/ssh2)：SSH 连接支持
- [systeminformation](https://github.com/sebhildebrandt/systeminformation)：本机系统信息支持

---

## 协议与免责声明

本项目采用 [MIT License](LICENSE) 开源协议。

MCServerTools 只提供服务器管理、文件下载和连接工具，不代表 Mojang、Microsoft、Oracle、MSL、FRP 或任何 Minecraft 服务端核心项目。项目使用 MSL 提供的公开接口，但与 MSL 开服器不存在隶属或官方合作关系。使用第三方软件、服务端核心和远程服务器时，请遵守对应项目的许可证、服务条款及当地法律法规。

使用本工具运行 Minecraft 服务端前，请阅读并接受 [Minecraft EULA](https://www.minecraft.net/en-us/eula)。
