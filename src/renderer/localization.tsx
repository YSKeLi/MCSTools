import React, { useEffect } from 'react'
import { CustomConverter } from 'opencc-js/core'
import simplifiedToTraditionalCharacters from 'opencc-js/dict/STCharacters'

type SupportedLanguage = Exclude<LanguagePreference, 'system'>
type TranslationEntry = readonly [source: string, en: string, ja: string, ko: string]

const entries: TranslationEntry[] = [
  ['首页', 'Home', 'ホーム', '홈'],
  ['核心下载', 'Core downloads', 'コアのダウンロード', '코어 다운로드'],
  ['云服务器', 'Cloud servers', 'クラウドサーバー', '클라우드 서버'],
  ['本地服务器', 'Local servers', 'ローカルサーバー', '로컬 서버'],
  ['FRP 穿透', 'FRP tunneling', 'FRP トンネリング', 'FRP 터널링'],
  ['Java 管理', 'Java management', 'Java 管理', 'Java 관리'],
  ['设置', 'Settings', '設定', '설정'],
  ['关于', 'About', 'このアプリについて', '정보'],
  ['工作台', 'Workspace', 'ワークスペース', '작업 공간'],
  ['系统', 'System', 'システム', '시스템'],
  ['主导航', 'Main navigation', 'メインナビゲーション', '주 탐색'],
  ['控制台', 'Console', 'コンソール', '콘솔'],
  ['返回', 'Back', '戻る', '뒤로'],
  ['外观', 'Appearance', '外観', '모양'],
  ['通用', 'General', '一般', '일반'],
  ['更新', 'Updates', 'アップデート', '업데이트'],
  ['设置分类', 'Settings categories', '設定カテゴリ', '설정 범주'],
  ['语言', 'Language', '言語', '언어'],
  ['跟随系统', 'Follow system', 'システムに合わせる', '시스템 설정 사용'],
  ['简体中文', 'Simplified Chinese', '簡体字中国語', '중국어(간체)'],
  ['繁体中文', 'Traditional Chinese', '繁体字中国語', '중국어(번체)'],
  ['日本語', '日本語', '日本語', '일본어'],
  ['切换后会立即应用到整个应用。', 'Changes apply immediately throughout the app.', '変更はアプリ全体にすぐ適用されます。', '변경 사항은 앱 전체에 즉시 적용됩니다.'],
  ['主题色', 'Accent color', 'テーマカラー', '테마 색상'],
  ['用于导航、按钮和状态高亮。', 'Used for navigation, buttons, and status highlights.', 'ナビゲーション、ボタン、状態表示に使用します。', '탐색, 버튼, 상태 강조에 사용됩니다.'],
  ['森林绿', 'Forest green', 'フォレストグリーン', '포레스트 그린'],
  ['湖蓝', 'Lake blue', 'レイクブルー', '레이크 블루'],
  ['琥珀', 'Amber', 'アンバー', '앰버'],
  ['莓红', 'Berry red', 'ベリーレッド', '베리 레드'],
  ['藤紫', 'Wisteria', '藤色', '등나무 보라'],
  ['青灰', 'Teal gray', '青灰色', '청회색'],
  ['自定义背景图', 'Custom background image', 'カスタム背景画像', '사용자 지정 배경 이미지'],
  ['支持 PNG、JPG、WEBP、GIF 和 BMP，最大 20 MB。', 'Supports PNG, JPG, WEBP, GIF, and BMP up to 20 MB.', 'PNG、JPG、WEBP、GIF、BMP（最大 20 MB）に対応します。', 'PNG, JPG, WEBP, GIF, BMP 형식을 최대 20MB까지 지원합니다.'],
  ['选择图片', 'Choose image', '画像を選択', '이미지 선택'],
  ['更换图片', 'Change image', '画像を変更', '이미지 변경'],
  ['清除', 'Clear', 'クリア', '지우기'],
  ['背景透明度', 'Background transparency', '背景の透明度', '배경 투명도'],
  ['数值越高，背景图片越透明。', 'Higher values make the background image more transparent.', '値が高いほど背景画像が透明になります。', '값이 높을수록 배경 이미지가 더 투명해집니다.'],
  ['管理应用语言、主题色和背景图片。', 'Manage the app language, accent color, and background image.', 'アプリの言語、テーマカラー、背景画像を管理します。', '앱 언어, 테마 색상, 배경 이미지를 관리합니다.'],
  ['管理应用启动和窗口关闭行为。', 'Manage app startup and window close behavior.', 'アプリの起動とウィンドウを閉じる動作を管理します。', '앱 시작 및 창 닫기 동작을 관리합니다.'],
  ['开机自启动', 'Launch at startup', 'ログイン時に起動', '시작 시 자동 실행'],
  ['登录系统后自动启动 MC Server Tools。', 'Start MC Server Tools automatically after signing in.', 'システムへのログイン後に MC Server Tools を自動起動します。', '시스템 로그인 후 MC Server Tools를 자동으로 실행합니다.'],
  ['关闭窗口行为', 'Close window behavior', 'ウィンドウを閉じる動作', '창 닫기 동작'],
  ['决定点击窗口关闭按钮时应用如何处理。', 'Choose what happens when the window close button is clicked.', 'ウィンドウの閉じるボタンを押したときの動作を選択します。', '창 닫기 버튼을 클릭할 때의 동작을 선택합니다.'],
  ['关闭应用', 'Quit application', 'アプリを終了', '앱 종료'],
  ['最小化到托盘', 'Minimize to tray', 'トレイに最小化', '트레이로 최소화'],
  ['应用设置无效', 'Invalid application settings.', 'アプリ設定が無効です。', '앱 설정이 올바르지 않습니다.'],
  ['应用设置包含不支持的字段', 'Application settings contain an unsupported field.', 'アプリ設定に未対応の項目が含まれています。', '앱 설정에 지원되지 않는 항목이 포함되어 있습니다.'],
  ['语言设置无效', 'Invalid language setting.', '言語設定が無効です。', '언어 설정이 올바르지 않습니다.'],
  ['主题色设置无效', 'Invalid accent color setting.', 'テーマカラー設定が無効です。', '테마 색상 설정이 올바르지 않습니다.'],
  ['背景图片设置无效', 'Invalid background image setting.', '背景画像設定が無効です。', '배경 이미지 설정이 올바르지 않습니다.'],
  ['背景透明度设置无效', 'Invalid background transparency setting.', '背景の透明度設定が無効です。', '배경 투명도 설정이 올바르지 않습니다.'],
  ['开机启动设置无效', 'Invalid launch-at-startup setting.', 'ログイン時起動の設定が無効です。', '시작 시 자동 실행 설정이 올바르지 않습니다.'],
  ['关闭窗口行为设置无效', 'Invalid close window behavior.', 'ウィンドウを閉じる動作の設定が無効です。', '창 닫기 동작 설정이 올바르지 않습니다.'],
  ['更新设置无效', 'Invalid update setting.', 'アップデート設定が無効です。', '업데이트 설정이 올바르지 않습니다.'],
  ['背景图片不存在', 'The background image does not exist.', '背景画像が見つかりません。', '배경 이미지가 없습니다.'],
  ['背景图片不能超过 20 MB', 'The background image cannot exceed 20 MB.', '背景画像は 20 MB 以下にしてください。', '배경 이미지는 20MB를 초과할 수 없습니다.'],
  ['仅支持 PNG、JPG、WEBP、GIF 或 BMP 图片', 'Only PNG, JPG, WEBP, GIF, or BMP images are supported.', 'PNG、JPG、WEBP、GIF、BMP 画像のみ対応しています。', 'PNG, JPG, WEBP, GIF 또는 BMP 이미지만 지원합니다.'],
  ['插件服务端', 'Plugin servers', 'プラグインサーバー', '플러그인 서버'],
  ['NeoForge 系混合服务端', 'NeoForge hybrid servers', 'NeoForge 系ハイブリッドサーバー', 'NeoForge 하이브리드 서버'],
  ['Fabric 混合服务端', 'Fabric hybrid servers', 'Fabric ハイブリッドサーバー', 'Fabric 하이브리드 서버'],
  ['NeoForge 系模组服务端', 'NeoForge mod servers', 'NeoForge 系 Mod サーバー', 'NeoForge 모드 서버'],
  ['Fabric 模组服务端', 'Fabric mod servers', 'Fabric Mod サーバー', 'Fabric 모드 서버'],
  ['原版服务端', 'Vanilla servers', 'バニラサーバー', '바닐라 서버'],
  ['基岩版服务端', 'Bedrock servers', '統合版サーバー', '베드락 서버'],
  ['代理服务端', 'Proxy servers', 'プロキシサーバー', '프록시 서버'],
  ['支持 Bukkit、Spigot、Paper 等插件生态的服务端核心。', 'Server cores for the Bukkit, Spigot, and Paper plugin ecosystem.', 'Bukkit、Spigot、Paper などのプラグイン環境に対応するサーバーコアです。', 'Bukkit, Spigot, Paper 플러그인 생태계를 지원하는 서버 코어입니다.'],
  ['同时支持 NeoForge 或 Forge 模组与插件的混合核心。', 'A hybrid core supporting NeoForge or Forge mods and plugins.', 'NeoForge または Forge の Mod とプラグインを同時に使用できるハイブリッドコアです。', 'NeoForge 또는 Forge 모드와 플러그인을 함께 지원하는 하이브리드 코어입니다.'],
  ['同时支持 Fabric 模组与插件的混合核心。', 'A hybrid core supporting Fabric mods and plugins.', 'Fabric の Mod とプラグインを同時に使用できるハイブリッドコアです。', 'Fabric 모드와 플러그인을 함께 지원하는 하이브리드 코어입니다.'],
  ['专门用于运行 NeoForge 或 Forge 模组的核心。', 'A core for running NeoForge or Forge mods.', 'NeoForge または Forge の Mod を実行するためのコアです。', 'NeoForge 또는 Forge 모드를 실행하기 위한 코어입니다.'],
  ['专门用于运行 Fabric 或 Quilt 模组的核心。', 'A core for running Fabric or Quilt mods.', 'Fabric または Quilt の Mod を実行するためのコアです。', 'Fabric 또는 Quilt 모드를 실행하기 위한 코어입니다.'],
  ['Minecraft 官方原版服务端核心。', 'The official Minecraft vanilla server core.', 'Minecraft 公式のバニラサーバーコアです。', 'Minecraft 공식 바닐라 서버 코어입니다.'],
  ['用于基岩版的服务端核心，部分版本为压缩包。', 'Server cores for Bedrock Edition; some versions are archives.', '統合版向けのサーバーコアです。一部のバージョンは圧縮ファイルです。', '베드락 에디션용 서버 코어이며 일부 버전은 압축 파일입니다.'],
  ['用于连接多个服务器实例的代理核心。', 'A proxy core for connecting multiple server instances.', '複数のサーバーインスタンスを接続するためのプロキシコアです。', '여러 서버 인스턴스를 연결하는 프록시 코어입니다.'],
  ['最早的 Bukkit 服务端实现，需通过 BuildTools 编译', 'The original Bukkit server implementation; requires BuildTools compilation.', '初期の Bukkit サーバー実装です。BuildTools でのビルドが必要です。', '초기 Bukkit 서버 구현이며 BuildTools로 빌드해야 합니다.'],
  ['CraftBukkit 优化版，性能更好，插件兼容', 'An optimized CraftBukkit build with better performance and plugin compatibility.', 'CraftBukkit の最適化版で、性能とプラグイン互換性を向上しています。', 'CraftBukkit 최적화 버전으로 성능과 플러그인 호환성이 향상되었습니다.'],
  ['轻量级 Mod 加载器，加载快，版本更新迅速', 'A lightweight mod loader with fast startup and frequent updates.', '起動が速く、更新も迅速な軽量 Mod ローダーです。', '빠르게 로드되고 업데이트가 잦은 경량 모드 로더입니다.'],
  ['最流行的 Mod 加载器，支持大量 Mod', 'The most popular mod loader, supporting a large mod ecosystem.', '多くの Mod に対応する、最も普及した Mod ローダーです。', '대규모 모드 생태계를 지원하는 가장 널리 쓰이는 모드 로더입니다.'],
  ['混合核心，同时支持 Forge Mod 和 Bukkit 插件', 'A hybrid core supporting Forge mods and Bukkit plugins.', 'Forge Mod と Bukkit プラグインを同時に使用できるハイブリッドコアです。', 'Forge 모드와 Bukkit 플러그인을 함께 지원하는 하이브리드 코어입니다.'],
  ['Forge 的下一代分支，社区驱动开发', 'A community-driven next-generation fork of Forge.', 'コミュニティ主導で開発される Forge の次世代フォークです。', '커뮤니티 주도로 개발되는 Forge의 차세대 포크입니다.'],
  ['高性能 Bukkit 分支，修复了大量 Vanilla/Spigot 漏洞，社区最活跃', 'A high-performance Bukkit fork with many Vanilla and Spigot fixes and an active community.', '多数の Vanilla／Spigot の不具合を修正した高性能 Bukkit フォークです。', '많은 Vanilla 및 Spigot 문제를 수정한 고성능 Bukkit 포크입니다.'],
  ['Paper 分支，提供更多自定义配置选项', 'A Paper fork with additional configuration options.', '追加のカスタマイズ設定を提供する Paper フォークです。', '추가 사용자 지정 설정을 제공하는 Paper 포크입니다.'],
  ['全新架构的 Mod API，稳定且高性能', 'A stable, high-performance mod API with a modern architecture.', '新しい設計による、安定性と性能に優れた Mod API です。', '새 아키텍처 기반의 안정적이고 고성능인 모드 API입니다.'],
  ['Mojang 官方原版服务端，最纯净的 Minecraft 体验', 'The official Mojang vanilla server for the purest Minecraft experience.', 'Mojang 公式のバニラサーバーで、純粋な Minecraft 体験を提供します。', '가장 순수한 Minecraft 경험을 제공하는 Mojang 공식 바닐라 서버입니다.'],
  ['Windows x64 安装程序', 'Windows x64 installer', 'Windows x64 インストーラー', 'Windows x64 설치 프로그램'],
  ['Windows x64 MSI 安装包', 'Windows x64 MSI package', 'Windows x64 MSI パッケージ', 'Windows x64 MSI 패키지'],
  ['Windows x64 压缩包', 'Windows x64 archive', 'Windows x64 圧縮ファイル', 'Windows x64 압축 파일'],
  ['Windows x64 兼容安装程序', 'Windows x64 compatibility installer', 'Windows x64 互換インストーラー', 'Windows x64 호환 설치 프로그램'],
  ['适合普通用户，下载后按安装向导完成安装。', 'Recommended for most users; follow the setup wizard after downloading.', '一般ユーザー向けです。ダウンロード後、セットアップウィザードに従ってください。', '일반 사용자용이며 다운로드 후 설치 마법사를 따르면 됩니다.'],
  ['适合企业部署、静默安装或由管理员统一分发。', 'For enterprise deployment, silent installation, or managed distribution.', '企業展開、サイレントインストール、管理者による一括配布向けです。', '기업 배포, 자동 설치 또는 관리자 일괄 배포용입니다.'],
  ['免安装版本，适合手动管理 Java 目录。', 'A portable build for manually managed Java directories.', 'インストール不要で、Java ディレクトリを手動管理する場合に適しています。', '설치 없이 Java 디렉터리를 직접 관리할 때 적합합니다.'],
  ['已匹配 Windows x64，普通安装推荐 EXE；企业部署可选择 MSI。', 'Windows x64 detected. Use EXE for regular installation or MSI for enterprise deployment.', 'Windows x64 を検出しました。通常は EXE、企業展開には MSI を推奨します。', 'Windows x64를 감지했습니다. 일반 설치는 EXE, 기업 배포는 MSI를 권장합니다.'],
  ['适用于多数 Linux 发行版，需要手动解压并配置 Java 路径。', 'Works on most Linux distributions; extract it and configure the Java path manually.', '多くの Linux ディストリビューションで利用できます。展開後に Java パスを手動設定してください。', '대부분의 Linux 배포판에서 사용할 수 있으며 압축 해제 후 Java 경로를 직접 설정해야 합니다.'],
  ['适用于 Debian、Ubuntu 及其衍生发行版，可由系统包管理器安装。', 'For Debian, Ubuntu, and derivatives; install with the system package manager.', 'Debian、Ubuntu、および派生ディストリビューション向けで、パッケージマネージャーから導入できます。', 'Debian, Ubuntu 및 파생 배포판용이며 시스템 패키지 관리자로 설치할 수 있습니다.'],
  ['适用于 Fedora、RHEL、CentOS、Rocky Linux、Oracle Linux 等 RPM 系发行版。', 'For RPM-based distributions such as Fedora, RHEL, CentOS, Rocky Linux, and Oracle Linux.', 'Fedora、RHEL、CentOS、Rocky Linux、Oracle Linux などの RPM 系向けです。', 'Fedora, RHEL, CentOS, Rocky Linux, Oracle Linux 등 RPM 계열 배포판용입니다.'],
  ['未识别到 serverAddr，将按原文件启动。', 'serverAddr was not detected; the original file will be used.', 'serverAddr を検出できないため、元のファイルのまま起動します。', 'serverAddr를 찾지 못해 원본 파일로 실행합니다.'],
  ['未识别到代理名称，列表中将使用文件名或你填写的名称。', 'No proxy name was detected; the file name or entered name will be used.', 'プロキシ名を検出できないため、ファイル名または入力した名前を使用します。', '프록시 이름을 찾지 못해 파일 이름 또는 입력한 이름을 사용합니다.'],
  ['未检测到 [[proxies]] 段，界面只能展示部分字段。', 'No [[proxies]] section was found; only some fields can be displayed.', '[[proxies]] セクションがないため、一部の項目のみ表示できます。', '[[proxies]] 섹션을 찾지 못해 일부 항목만 표시할 수 있습니다.'],
  ['启动时检查更新', 'Check for updates at startup', '起動時にアップデートを確認', '시작 시 업데이트 확인'],
  ['应用启动后自动检查新版本，并在有更新时提醒。', 'Check for new versions after startup and notify when one is available.', '起動後に新しいバージョンを確認し、更新がある場合に通知します。', '시작 후 새 버전을 확인하고 업데이트가 있으면 알립니다.'],
  ['检查新版本并管理启动时的更新提醒。', 'Check for new versions and manage startup update notifications.', '新しいバージョンを確認し、起動時の通知を管理します。', '새 버전을 확인하고 시작 시 업데이트 알림을 관리합니다.'],
  ['当前版本', 'Current version', '現在のバージョン', '현재 버전'],
  ['最新版本', 'Latest version', '最新バージョン', '최신 버전'],
  ['检查更新', 'Check for updates', 'アップデートを確認', '업데이트 확인'],
  ['检查中...', 'Checking...', '確認中...', '확인 중...'],
  ['打开发布页', 'Open release page', 'リリースページを開く', '릴리스 페이지 열기'],
  ['下载并安装', 'Download and install', 'ダウンロードしてインストール', '다운로드 및 설치'],
  ['下载中...', 'Downloading...', 'ダウンロード中...', '다운로드 중...'],
  ['正在准备更新下载...', 'Preparing the update download...', 'アップデートのダウンロードを準備中...', '업데이트 다운로드 준비 중...'],
  ['发现新版本', 'New version available', '新しいバージョンがあります', '새 버전이 있습니다'],
  ['当前已是最新版本', 'You are up to date', '最新バージョンです', '최신 버전입니다'],
  ['版本名称', 'Version name', 'バージョン名', '버전 이름'],
  ['发布时间', 'Published', '公開日時', '게시 시간'],
  ['来源仓库', 'Source repository', 'ソースリポジトリ', '소스 저장소'],
  ['更新内容', 'Release notes', '更新内容', '업데이트 내용'],
  ['上次检查：', 'Last checked:', '前回の確認：', '마지막 확인:'],
  ['保存设置失败', 'Failed to save settings', '設定を保存できませんでした', '설정을 저장하지 못했습니다'],
  ['选择背景图片失败', 'Failed to choose a background image', '背景画像を選択できませんでした', '배경 이미지를 선택하지 못했습니다'],
  ['清除背景图片失败', 'Failed to clear the background image', '背景画像を削除できませんでした', '배경 이미지를 지우지 못했습니다'],
  ['检查更新失败', 'Failed to check for updates', 'アップデートを確認できませんでした', '업데이트 확인에 실패했습니다'],
  ['下载更新失败', 'Failed to download the update', 'アップデートをダウンロードできませんでした', '업데이트 다운로드에 실패했습니다'],
  ['稍后', 'Later', '後で', '나중에'],
  ['重试', 'Retry', '再試行', '다시 시도'],
  ['渲染出错', 'Rendering error', 'レンダリングエラー', '렌더링 오류'],
  ['关闭', 'Close', '閉じる', '닫기'],
  ['关闭对话框', 'Close dialog', 'ダイアログを閉じる', '대화 상자 닫기'],
  ['浅色模式', 'Light mode', 'ライトモード', '라이트 모드'],
  ['深色模式', 'Dark mode', 'ダークモード', '다크 모드'],
  ['外观模式', 'Appearance mode', '表示モード', '화면 모드'],
  ['浅色', 'Light', 'ライト', '라이트'],
  ['深色', 'Dark', 'ダーク', '다크'],
  ['Minecraft 服务器搭建工具', 'Minecraft Server Tools', 'Minecraft サーバーツール', 'Minecraft 서버 도구'],
  ['服务器工作台', 'Server workspace', 'サーバーワークスペース', '서버 작업 공간'],
  ['Java 环境', 'Java environment', 'Java 環境', 'Java 환경'],
  ['管理 Java', 'Manage Java', 'Java を管理', 'Java 관리'],
  ['常用入口', 'Quick access', 'クイックアクセス', '빠른 실행'],
  ['选择核心', 'Choose a core', 'コアを選択', '코어 선택'],
  ['检测中...', 'Detecting...', '検出中...', '감지 중...'],
  ['检测中', 'Detecting', '検出中', '감지 중'],
  ['未检测到 Java', 'Java was not detected', 'Java が見つかりません', 'Java를 찾을 수 없습니다'],
  ['检测失败', 'Detection failed', '検出に失敗しました', '감지 실패'],
  ['版本', 'Version', 'バージョン', '버전'],
  ['制作者：小亚', 'Created by Xiaoya', '制作者：小亚', '제작자: Xiaoya'],
  ['服务端核心下载', 'Server core downloads', 'サーバーコアのダウンロード', '서버 코어 다운로드'],
  ['服务端', 'Server', 'サーバー', '서버'],
  ['核心类型（可选）', 'Core type (optional)', 'コアタイプ（任意）', '코어 유형(선택)'],
  ['版本（可选）', 'Version (optional)', 'バージョン（任意）', '버전(선택)'],
  ['搜索服务端分类', 'Search server categories', 'サーバーカテゴリを検索', '서버 범주 검색'],
  ['搜索当前分类下的核心', 'Search cores in this category', '現在のカテゴリのコアを検索', '현재 범주의 코어 검색'],
  ['搜索版本号', 'Search versions', 'バージョンを検索', '버전 검색'],
  ['选择服务端分类', 'Choose a server category', 'サーバーカテゴリを選択', '서버 범주 선택'],
  ['选择服务端核心', 'Choose a server core', 'サーバーコアを選択', '서버 코어 선택'],
  ['选择版本并下载', 'Choose a version and download', 'バージョンを選択してダウンロード', '버전을 선택하고 다운로드'],
  ['选择服务端分类', 'Choose server category', 'サーバーカテゴリを選択', '서버 범주 선택'],
  ['选择版本', 'Choose a version', 'バージョンを選択', '버전 선택'],
  ['请选择版本', 'Choose a version', 'バージョンを選択してください', '버전을 선택하세요'],
  ['正在读取版本...', 'Loading versions...', 'バージョンを読み込み中...', '버전 불러오는 중...'],
  ['版本列表获取失败', 'Failed to load the version list', 'バージョン一覧を取得できませんでした', '버전 목록을 불러오지 못했습니다'],
  ['该核心当前没有可下载版本', 'No downloadable versions are available for this core', 'このコアにはダウンロード可能なバージョンがありません', '이 코어에는 다운로드 가능한 버전이 없습니다'],
  ['没有匹配的分类。', 'No matching categories.', '一致するカテゴリがありません。', '일치하는 범주가 없습니다.'],
  ['当前分类下没有匹配的核心。', 'No matching cores in this category.', 'このカテゴリに一致するコアがありません。', '이 범주에 일치하는 코어가 없습니다.'],
  ['未分类', 'Uncategorized', '未分類', '분류되지 않음'],
  ['个核心', 'cores', '個のコア', '개 코어'],
  ['版本与保存位置', 'Version and save location', 'バージョンと保存先', '버전 및 저장 위치'],
  ['服务器名称', 'Server name', 'サーバー名', '서버 이름'],
  ['保存目录', 'Save directory', '保存先', '저장 폴더'],
  ['选择目录', 'Choose directory', 'フォルダーを選択', '폴더 선택'],
  ['请输入服务端名称', 'Enter a server name', 'サーバー名を入力してください', '서버 이름을 입력하세요'],
  ['下载', 'Download', 'ダウンロード', '다운로드'],
  ['下载失败', 'Download failed', 'ダウンロードに失敗しました', '다운로드 실패'],
  ['已完成', 'Completed', '完了', '완료'],
  ['正在准备下载...', 'Preparing download...', 'ダウンロードを準備中...', '다운로드 준비 중...'],
  ['下载完成，已加入服务器列表：', 'Download complete. Added to the server list:', 'ダウンロードが完了し、サーバー一覧に追加しました：', '다운로드 완료. 서버 목록에 추가됨:'],
  ['下载完成：', 'Download complete:', 'ダウンロード完了：', '다운로드 완료:'],
  ['该文件需要手动处理后再导入。', 'This file must be processed manually before importing.', 'このファイルは手動で処理してからインポートしてください。', '이 파일은 수동으로 처리한 후 가져와야 합니다.'],
  ['打开官网', 'Open website', '公式サイトを開く', '공식 사이트 열기'],
  ['原版', 'Vanilla', 'バニラ', '바닐라'],
  ['插件', 'Plugin', 'プラグイン', '플러그인'],
  ['模组', 'Modded', 'Mod', '모드'],
  ['混合', 'Hybrid', 'ハイブリッド', '하이브리드'],
  ['本地', 'Local', 'ローカル', '로컬'],
  ['远程', 'Remote', 'リモート', '원격'],
  ['添加', 'Add', '追加', '추가'],
  ['添加服务器', 'Add server', 'サーバーを追加', '서버 추가'],
  ['添加已有服务器', 'Add existing server', '既存のサーバーを追加', '기존 서버 추가'],
  ['添加云服务器', 'Add cloud server', 'クラウドサーバーを追加', '클라우드 서버 추가'],
  ['连接云服务器', 'Connect cloud server', 'クラウドサーバーに接続', '클라우드 서버 연결'],
  ['你还没有云服务器，快添加吧', 'No cloud servers yet. Add one to get started.', 'クラウドサーバーはまだありません。追加してください。', '클라우드 서버가 없습니다. 지금 추가하세요.'],
  ['台已连接', 'connected', '台接続済み', '대 연결됨'],
  ['打开管理', 'Manage', '管理を開く', '관리 열기'],
  ['云服务器管理', 'Cloud server management', 'クラウドサーバー管理', '클라우드 서버 관리'],
  ['远程系统状态', 'Remote system status', 'リモートシステム状態', '원격 시스템 상태'],
  ['Minecraft 服务器', 'Minecraft servers', 'Minecraft サーバー', 'Minecraft 서버'],
  ['添加服务器目录', 'Add server directory', 'サーバーディレクトリを追加', '서버 디렉터리 추가'],
  ['还没有添加 Minecraft 服务器目录', 'No Minecraft server directories have been added', 'Minecraft サーバーディレクトリはまだ追加されていません', 'Minecraft 서버 디렉터리가 아직 추가되지 않았습니다'],
  ['自动查找或手动添加', 'Find automatically or add manually', '自動検索または手動追加', '자동 검색 또는 수동 추가'],
  ['添加远程 Minecraft 服务器', 'Add remote Minecraft server', 'リモート Minecraft サーバーを追加', '원격 Minecraft 서버 추가'],
  ['自动查找', 'Find automatically', '自動検索', '자동 검색'],
  ['手动添加', 'Add manually', '手動追加', '수동 추가'],
  ['查找 server.properties', 'Find server.properties', 'server.properties を検索', 'server.properties 찾기'],
  ['检查目录', 'Check directory', 'ディレクトリを確認', '디렉터리 확인'],
  ['浏览远程目录', 'Browse remote folders', 'リモートフォルダーを参照', '원격 폴더 찾아보기'],
  ['选择远程服务器目录', 'Choose remote server folder', 'リモートサーバーフォルダーを選択', '원격 서버 폴더 선택'],
  ['选择当前目录', 'Choose current folder', '現在のフォルダーを選択', '현재 폴더 선택'],
  ['请从远程文件列表选择目录', 'Choose a folder from the remote file list', 'リモートファイル一覧からフォルダーを選択', '원격 파일 목록에서 폴더를 선택하세요'],
  ['返回上级目录', 'Go to parent folder', '親フォルダーに戻る', '상위 폴더로 이동'],
  ['刷新目录', 'Refresh folder', 'フォルダーを更新', '폴더 새로 고침'],
  ['远程磁盘', 'Remote drives', 'リモートドライブ', '원격 드라이브'],
  ['当前目录包含 server.properties，可以选择', 'This folder contains server.properties and can be selected', 'このフォルダーには server.properties があり、選択できます', '이 폴더에는 server.properties가 있어 선택할 수 있습니다'],
  ['正在读取远程文件...', 'Loading remote files...', 'リモートファイルを読み込み中...', '원격 파일 불러오는 중...'],
  ['此目录为空', 'This folder is empty', 'このフォルダーは空です', '이 폴더는 비어 있습니다'],
  ['打开', 'Open', '開く', '열기'],
  ['服务端 JAR', 'Server JAR', 'サーバー JAR', '서버 JAR'],
  ['备注', 'Notes', 'メモ', '메모'],
  ['版本', 'Version', 'バージョン', '버전'],
  ['类型', 'Type', 'タイプ', '유형'],
  ['移除远程服务器', 'Remove remote server', 'リモートサーバーを削除', '원격 서버 제거'],
  ['请先停止服务器', 'Stop the server first', '先にサーバーを停止してください', '먼저 서버를 중지하세요'],
  ['还没有本地服务器', 'No local servers yet', 'ローカルサーバーはまだありません', '로컬 서버가 없습니다'],
  ['还没有云服务器', 'No cloud servers yet', 'クラウドサーバーはまだありません', '클라우드 서버가 없습니다'],
  ['暂无已保存的服务器', 'No saved servers', '保存済みサーバーはありません', '저장된 서버가 없습니다'],
  ['服务器列表', 'Server list', 'サーバー一覧', '서버 목록'],
  ['服务器配置', 'Server configuration', 'サーバー設定', '서버 설정'],
  ['服务端目录', 'Server directory', 'サーバーフォルダー', '서버 폴더'],
  ['JAR 文件名', 'JAR file name', 'JAR ファイル名', 'JAR 파일 이름'],
  ['内存', 'Memory', 'メモリ', '메모리'],
  ['选择 Java', 'Choose Java', 'Java を選択', 'Java 선택'],
  ['自动检测', 'Auto detect', '自動検出', '자동 감지'],
  ['恢复自动检测', 'Restore auto detection', '自動検出に戻す', '자동 감지 복원'],
  ['未配置 Java 路径', 'No Java path configured', 'Java パスが設定されていません', 'Java 경로가 설정되지 않았습니다'],
  ['服务器未运行', 'Server is not running', 'サーバーは停止しています', '서버가 실행 중이 아닙니다'],
  ['服务器正在启动', 'Server is starting', 'サーバーを起動中です', '서버 시작 중'],
  ['服务器正在停止', 'Server is stopping', 'サーバーを停止中です', '서버 중지 중'],
  ['服务器启动失败', 'Server failed to start', 'サーバーの起動に失敗しました', '서버 시작 실패'],
  ['启动', 'Start', '起動', '시작'],
  ['启动中', 'Starting', '起動中', '시작 중'],
  ['启动失败', 'Startup failed', '起動に失敗しました', '시작 실패'],
  ['停止', 'Stop', '停止', '중지'],
  ['停止中', 'Stopping', '停止中', '중지 중'],
  ['运行中', 'Running', '実行中', '실행 중'],
  ['外部运行中', 'Running externally', '外部プロセスで実行中', '외부 프로세스로 실행 중'],
  ['当前连接仅支持查看日志', 'This connection is log-only', 'この接続ではログのみ表示できます', '현재 연결에서는 로그만 볼 수 있습니다'],
  ['未运行', 'Not running', '停止中', '실행 중 아님'],
  ['服务器描述', 'Server description', 'サーバー説明', '서버 설명'],
  ['显示在服务器列表的描述文字', 'Description shown in the server list', 'サーバー一覧に表示する説明', '서버 목록에 표시되는 설명'],
  ['服务器监听的端口号', 'Port the server listens on', 'サーバーが待ち受けるポート', '서버가 수신하는 포트'],
  ['最大玩家数', 'Maximum players', '最大プレイヤー数', '최대 플레이어 수'],
  ['同时在线最大玩家数', 'Maximum concurrent players', '同時接続できる最大プレイヤー数', '최대 동시 접속 플레이어 수'],
  ['正版验证', 'Online-mode verification', '正規アカウント認証', '정품 인증'],
  ['是否开启 Mojang 正版验证', 'Require Mojang account verification', 'Mojang の正規アカウント認証を有効にする', 'Mojang 정품 인증 사용 여부'],
  ['难度', 'Difficulty', '難易度', '난이도'],
  ['游戏难度', 'Game difficulty', 'ゲームの難易度', '게임 난이도'],
  ['默认游戏模式', 'Default game mode', 'デフォルトゲームモード', '기본 게임 모드'],
  ['新玩家的默认游戏模式', 'Default game mode for new players', '新規プレイヤーのデフォルトゲームモード', '새 플레이어의 기본 게임 모드'],
  ['是否允许玩家互相攻击', 'Allow players to attack each other', 'プレイヤー同士の攻撃を許可する', '플레이어 간 공격 허용 여부'],
  ['世界名称', 'World name', 'ワールド名', '월드 이름'],
  ['地图/世界文件夹名称', 'Map/world folder name', 'マップ／ワールドフォルダー名', '맵/월드 폴더 이름'],
  ['世界种子', 'World seed', 'ワールドシード', '월드 시드'],
  ['地图随机种子（留空随机）', 'Map seed (leave blank for random)', 'マップシード（空欄でランダム）', '맵 시드(비워두면 무작위)'],
  ['允许飞行', 'Allow flight', '飛行を許可', '비행 허용'],
  ['是否允许玩家飞行', 'Allow players to fly', 'プレイヤーの飛行を許可する', '플레이어 비행 허용 여부'],
  ['硬核模式', 'Hardcore mode', 'ハードコアモード', '하드코어 모드'],
  ['开启后死亡即被服务器封禁', 'Ban players from the server when they die', '有効にすると死亡時にサーバーからBANされます', '활성화하면 사망 시 서버에서 차단됩니다'],
  ['白名单', 'Allowlist', 'ホワイトリスト', '화이트리스트'],
  ['是否开启白名单模式', 'Enable allowlist mode', 'ホワイトリストを有効にする', '화이트리스트 모드 사용 여부'],
  ['强制白名单', 'Enforce allowlist', 'ホワイトリストを強制', '화이트리스트 강제'],
  ['不在白名单中的玩家将被踢出', 'Kick players who are not on the allowlist', 'ホワイトリストにないプレイヤーを退出させる', '화이트리스트에 없는 플레이어를 내보냅니다'],
  ['出生点保护', 'Spawn protection', 'スポーン保護', '스폰 보호'],
  ['出生点保护半径（格）', 'Spawn protection radius (blocks)', 'スポーン保護半径（ブロック）', '스폰 보호 반경(블록)'],
  ['视距', 'View distance', '描画距離', '시야 거리'],
  ['服务器发送给客户端的区块距离', 'Chunk distance sent to clients', 'クライアントに送信するチャンク距離', '클라이언트에 전송하는 청크 거리'],
  ['模拟距离', 'Simulation distance', 'シミュレーション距離', '시뮬레이션 거리'],
  ['服务器模拟的区块距离', 'Chunk distance simulated by the server', 'サーバーがシミュレートするチャンク距離', '서버가 시뮬레이션하는 청크 거리'],
  ['允许命令方块', 'Allow command blocks', 'コマンドブロックを許可', '명령 블록 허용'],
  ['是否启用命令方块', 'Enable command blocks', 'コマンドブロックを有効にする', '명령 블록 사용 여부'],
  ['启用查询', 'Enable query', 'クエリを有効化', '쿼리 사용'],
  ['允许 GameSpy4 查询协议', 'Allow the GameSpy4 query protocol', 'GameSpy4 クエリプロトコルを許可する', 'GameSpy4 쿼리 프로토콜 허용'],
  ['启用远程控制', 'Enable remote control', 'リモートコントロールを有効化', '원격 제어 사용'],
  ['允许 Rcon 远程管理', 'Allow RCON remote management', 'RCON によるリモート管理を許可する', 'RCON 원격 관리 허용'],
  ['RCON 密码', 'RCON password', 'RCON パスワード', 'RCON 비밀번호'],
  ['远程控制密码', 'Remote control password', 'リモートコントロールのパスワード', '원격 제어 비밀번호'],
  ['RCON 端口', 'RCON port', 'RCON ポート', 'RCON 포트'],
  ['远程控制端口', 'Remote control port', 'リモートコントロールのポート', '원격 제어 포트'],
  ['广播 RC 操作', 'Broadcast RCON operations', 'RCON 操作を通知', 'RCON 작업 알림'],
  ['RCON 操作是否广播给管理员', 'Broadcast RCON operations to administrators', 'RCON 操作を管理者に通知する', 'RCON 작업을 관리자에게 알릴지 여부'],
  ['最大世界大小', 'Maximum world size', 'ワールドの最大サイズ', '최대 월드 크기'],
  ['世界边界大小（格）', 'World border size (blocks)', 'ワールド境界サイズ（ブロック）', '월드 경계 크기(블록)'],
  ['网络压缩阈值', 'Network compression threshold', 'ネットワーク圧縮しきい値', '네트워크 압축 임계값'],
  ['网络数据包压缩阈值（字节）', 'Network packet compression threshold (bytes)', 'ネットワークパケットの圧縮しきい値（バイト）', '네트워크 패킷 압축 임계값(바이트)'],
  ['速率限制', 'Rate limit', 'レート制限', '속도 제한'],
  ['玩家数据包速率限制', 'Player packet rate limit', 'プレイヤーパケットのレート制限', '플레이어 패킷 속도 제한'],
  ['强制安全资料', 'Enforce secure profile', 'セキュアプロフィールを強制', '보안 프로필 강제'],
  ['要求玩家有 Mojang 签名', 'Require players to have Mojang signatures', 'プレイヤーに Mojang 署名を要求する', '플레이어에게 Mojang 서명 요구'],
  ['禁止代理连接', 'Block proxy connections', 'プロキシ接続を禁止', '프록시 연결 금지'],
  ['禁止通过代理连接服务器', 'Block connections through proxies', 'プロキシ経由のサーバー接続を禁止する', '프록시를 통한 서버 연결 금지'],
  ['闲置超时', 'Idle timeout', 'アイドルタイムアウト', '유휴 시간 제한'],
  ['玩家挂机踢出时间（分钟），0 为不踢', 'Idle kick time (minutes); 0 disables kicking', 'アイドル状態で退出させる時間（分）。0 で無効', '자리 비움 추방 시간(분), 0은 비활성화'],
  ['生成动物', 'Spawn animals', '動物をスポーン', '동물 생성'],
  ['是否生成动物', 'Spawn animals', '動物をスポーンさせる', '동물 생성 여부'],
  ['生成怪物', 'Spawn monsters', 'モンスターをスポーン', '몬스터 생성'],
  ['是否生成怪物', 'Spawn monsters', 'モンスターをスポーンさせる', '몬스터 생성 여부'],
  ['生成NPC', 'Spawn NPCs', 'NPC をスポーン', 'NPC 생성'],
  ['是否生成村民等 NPC', 'Spawn villagers and other NPCs', '村人などの NPC をスポーンさせる', '주민 등 NPC 생성 여부'],
  ['生成结构', 'Generate structures', '構造物を生成', '구조물 생성'],
  ['是否生成村庄、神殿等结构', 'Generate villages, temples, and other structures', '村や寺院などの構造物を生成する', '마을, 사원 등 구조물 생성 여부'],
  ['最大 Tick 时间', 'Maximum tick time', '最大 Tick 時間', '최대 Tick 시간'],
  ['单个 Tick 最大时间（毫秒）', 'Maximum time per tick (ms)', '1 Tick の最大時間（ミリ秒）', 'Tick당 최대 시간(밀리초)'],
  ['最大建筑高度', 'Maximum build height', '最大建築高度', '최대 건축 높이'],
  ['玩家可建造的最大高度', 'Maximum height players can build', 'プレイヤーが建築できる最大高度', '플레이어가 건축할 수 있는 최대 높이'],
  ['OP 权限等级', 'OP permission level', 'OP 権限レベル', 'OP 권한 수준'],
  ['管理员的默认权限等级 (1-4)', 'Default administrator permission level (1-4)', '管理者のデフォルト権限レベル（1-4）', '관리자 기본 권한 수준(1-4)'],
  ['函数权限等级', 'Function permission level', '関数の権限レベル', '함수 권한 수준'],
  ['函数的默认权限等级', 'Default function permission level', '関数のデフォルト権限レベル', '함수 기본 권한 수준'],
  ['实体广播范围', 'Entity broadcast range', 'エンティティ配信範囲', '엔티티 전송 범위'],
  ['实体追踪范围百分比', 'Entity tracking range percentage', 'エンティティ追跡範囲の割合', '엔티티 추적 범위 비율'],
  ['文本过滤', 'Text filtering', 'テキストフィルタリング', '텍스트 필터링'],
  ['聊天文本过滤配置', 'Chat text filtering configuration', 'チャットテキストのフィルター設定', '채팅 텍스트 필터링 설정'],
  ['强制结束进程', 'Force stop process', 'プロセスを強制終了', '프로세스 강제 종료'],
  ['发送命令', 'Send command', 'コマンドを送信', '명령 전송'],
  ['Minecraft 命令', 'Minecraft command', 'Minecraft コマンド', 'Minecraft 명령'],
  ['运行日志', 'Runtime log', '実行ログ', '실행 로그'],
  ['保存配置', 'Save configuration', '設定を保存', '설정 저장'],
  ['保存配置失败', 'Failed to save configuration', '設定を保存できませんでした', '설정을 저장하지 못했습니다'],
  ['server.properties 文件未找到或为空', 'server.properties was not found or is empty', 'server.properties が見つからないか空です', 'server.properties 파일이 없거나 비어 있습니다'],
  ['移除服务器', 'Remove server', 'サーバーを削除', '서버 제거'],
  ['仅从列表移除', 'Remove from list only', '一覧からのみ削除', '목록에서만 제거'],
  ['移除并删除文件', 'Remove and delete files', '削除してファイルも消去', '제거하고 파일 삭제'],
  ['仅可从列表移除', 'Can only be removed from the list', '一覧からのみ削除できます', '목록에서만 제거할 수 있습니다'],
  ['取消', 'Cancel', 'キャンセル', '취소'],
  ['删除', 'Delete', '削除', '삭제'],
  ['确定删除「', 'Delete “', '「', '“'],
  ['」吗？', '”?', '」を削除しますか？', '”을(를) 삭제하시겠습니까?'],
  ['当前配置', 'Current configuration', '現在の設定', '현재 설정'],
  ['未识别', 'Unrecognized', '認識されていません', '인식되지 않음'],
  ['未知', 'Unknown', '不明', '알 수 없음'],
  ['正在读取服务器列表...', 'Loading server list...', 'サーバー一覧を読み込み中...', '서버 목록 불러오는 중...'],
  ['刷新服务器列表', 'Refresh server list', 'サーバー一覧を更新', '서버 목록 새로 고침'],
  ['服务器系统', 'Server system', 'サーバー OS', '서버 운영체제'],
  ['服务器地址', 'Server address', 'サーバーアドレス', '서버 주소'],
  ['IP 地址或域名', 'IP address or domain', 'IP アドレスまたはドメイン', 'IP 주소 또는 도메인'],
  ['SSH 端口', 'SSH port', 'SSH ポート', 'SSH 포트'],
  ['账户名', 'Username', 'ユーザー名', '사용자 이름'],
  ['密码', 'Password', 'パスワード', '비밀번호'],
  ['显示密码', 'Show password', 'パスワードを表示', '비밀번호 표시'],
  ['隐藏密码', 'Hide password', 'パスワードを隠す', '비밀번호 숨기기'],
  ['验证主机指纹', 'Verify host fingerprint', 'ホストフィンガープリントを確認', '호스트 지문 확인'],
  ['确认指纹并连接', 'Confirm fingerprint and connect', 'フィンガープリントを確認して接続', '지문 확인 후 연결'],
  ['请确认主机指纹后继续：', 'Confirm the host fingerprint to continue:', 'ホストフィンガープリントを確認してください：', '계속하려면 호스트 지문을 확인하세요:'],
  ['连接中', 'Connecting', '接続中', '연결 중'],
  ['未连接', 'Not connected', '未接続', '연결되지 않음'],
  ['在线', 'Online', 'オンライン', '온라인'],
  ['离线', 'Offline', 'オフライン', '오프라인'],
  ['刷新监控数据', 'Refresh monitoring data', '監視データを更新', '모니터링 데이터 새로 고침'],
  ['删除连接', 'Delete connection', '接続を削除', '연결 삭제'],
  ['删除服务器连接', 'Delete server connection', 'サーバー接続を削除', '서버 연결 삭제'],
  ['仅删除本机保存的连接信息，不会操作远程服务器。', 'Only the locally saved connection is deleted; the remote server is not changed.', 'ローカルに保存された接続情報のみを削除し、リモートサーバーは変更しません。', '로컬에 저장된 연결 정보만 삭제하며 원격 서버는 변경하지 않습니다.'],
  ['正在连接服务器...', 'Connecting to server...', 'サーバーに接続中...', '서버에 연결하는 중...'],
  ['读取服务器状态', 'Read server status', 'サーバー状態を取得', '서버 상태 불러오기'],
  ['更新于', 'Updated', '更新日時', '업데이트 시간'],
  ['操作失败，请稍后重试', 'The operation failed. Try again later.', '操作に失敗しました。後でもう一度お試しください。', '작업에 실패했습니다. 잠시 후 다시 시도하세요.'],
  ['主机名', 'Host name', 'ホスト名', '호스트 이름'],
  ['运行时间', 'Uptime', '稼働時間', '가동 시간'],
  ['操作系统', 'Operating system', 'オペレーティングシステム', '운영체제'],
  ['内核版本', 'Kernel version', 'カーネルバージョン', '커널 버전'],
  ['内核与架构', 'Kernel and architecture', 'カーネルとアーキテクチャ', '커널 및 아키텍처'],
  ['处理器', 'Processor', 'プロセッサ', '프로세서'],
  ['文件系统', 'File system', 'ファイルシステム', '파일 시스템'],
  ['系统盘', 'System drive', 'システムドライブ', '시스템 드라이브'],
  ['可用', 'Available', '使用可能', '사용 가능'],
  ['设备', 'Device', 'デバイス', '장치'],
  ['本机设备状态', 'Local device status', 'ローカルデバイスの状態', '로컬 장치 상태'],
  ['刷新设备状态', 'Refresh device status', 'デバイス状態を更新', '장치 상태 새로 고침'],
  ['正在读取设备状态...', 'Reading device status...', 'デバイス状態を読み込み中...', '장치 상태 불러오는 중...'],
  ['读取设备信息失败', 'Failed to read device information', 'デバイス情報を取得できませんでした', '장치 정보를 불러오지 못했습니다'],
  ['天', 'days', '日', '일'],
  ['小时', 'hours', '時間', '시간'],
  ['分钟', 'minutes', '分', '분'],
  ['个物理核心', 'physical cores', '物理コア', '물리 코어'],
  ['个逻辑核心', 'logical cores', '論理コア', '논리 코어'],
  ['负载', 'Load', '負荷', '부하'],
  ['在线玩家', 'Online players', 'オンラインプレイヤー', '온라인 플레이어'],
  ['暂无玩家在线', 'No players online', 'オンラインのプレイヤーはいません', '온라인 플레이어가 없습니다'],
  ['选择服务器后可查看在线玩家', 'Choose a server to view online players', 'サーバーを選択するとオンラインプレイヤーを確認できます', '서버를 선택하면 온라인 플레이어를 볼 수 있습니다'],
  ['人在线', 'online', '人オンライン', '명 온라인'],
  ['的正版皮肤头像', ' official skin avatar', ' の公式スキンアバター', '의 정품 스킨 아바타'],
  ['的默认头像', ' default avatar', ' のデフォルトアバター', '의 기본 아바타'],
  ['的Alex默认头像', ' default Alex avatar', ' のデフォルト Alex アバター', '의 기본 Alex 아바타'],
  ['的Steve默认头像', ' default Steve avatar', ' のデフォルト Steve アバター', '의 기본 Steve 아바타'],
  ['管理 Java', 'Manage Java', 'Java を管理', 'Java 관리'],
  ['重新检测', 'Detect again', '再検出', '다시 감지'],
  ['官方页面', 'Official page', '公式ページ', '공식 페이지'],
  ['当前环境', 'Current environment', '現在の環境', '현재 환경'],
  ['未检测到', 'Not detected', '未検出', '감지되지 않음'],
  ['未检测到 Java 21', 'Java 21 was not detected', 'Java 21 が見つかりません', 'Java 21을 찾을 수 없습니다'],
  ['加载 Java 信息失败', 'Failed to load Java information', 'Java 情報を読み込めませんでした', 'Java 정보를 불러오지 못했습니다'],
  ['推荐下载', 'Recommended download', '推奨ダウンロード', '권장 다운로드'],
  ['其他下载方式', 'Other download options', 'その他のダウンロード方法', '기타 다운로드 방법'],
  ['下载并打开', 'Download and open', 'ダウンロードして開く', '다운로드 후 열기'],
  ['没有匹配的安装包', 'No matching packages', '一致するパッケージがありません', '일치하는 패키지가 없습니다'],
  ['原生架构', 'Native architecture', 'ネイティブアーキテクチャ', '네이티브 아키텍처'],
  ['兼容模式', 'Compatibility mode', '互換モード', '호환 모드'],
  ['下载 Java 失败', 'Failed to download Java', 'Java をダウンロードできませんでした', 'Java 다운로드 실패'],
  ['下载完成，已打开安装包：', 'Download complete. Opened installer:', 'ダウンロードが完了し、インストーラーを開きました：', '다운로드 완료. 설치 파일을 열었습니다:'],
  ['FRP 内网穿透', 'FRP tunneling', 'FRP トンネリング', 'FRP 터널링'],
  ['当前配置', 'Current configuration', '現在の設定', '현재 설정'],
  ['配置', 'Configuration', '設定', '설정'],
  ['配置名称', 'Configuration name', '設定名', '설정 이름'],
  ['配置文件路径', 'Configuration file path', '設定ファイルのパス', '설정 파일 경로'],
  ['导入配置', 'Import configuration', '設定をインポート', '설정 가져오기'],
  ['保存导入的配置', 'Save imported configuration', 'インポートした設定を保存', '가져온 설정 저장'],
  ['保存到列表', 'Save to list', '一覧に保存', '목록에 저장'],
  ['暂无已导入配置', 'No imported configurations', 'インポート済み設定はありません', '가져온 설정이 없습니다'],
  ['暂无已导入配置。', 'No imported configurations.', 'インポート済み設定はありません。', '가져온 설정이 없습니다.'],
  ['导入于', 'Imported', 'インポート日時', '가져온 시간'],
  ['最近使用', 'Last used', '最終使用', '최근 사용'],
  ['未使用', 'Never used', '未使用', '사용 안 함'],
  ['启动失败', 'Failed to start', '起動に失敗しました', '시작 실패'],
  ['删除配置', 'Delete configuration', '設定を削除', '설정 삭제'],
  ['删除配置失败', 'Failed to delete configuration', '設定を削除できませんでした', '설정 삭제 실패'],
  ['删除失败', 'Delete failed', '削除に失敗しました', '삭제 실패'],
  ['代理', 'Proxy', 'プロキシ', '프록시'],
  ['服务器地址', 'Server address', 'サーバーアドレス', '서버 주소'],
  ['服务器端口', 'Server port', 'サーバーポート', '서버 포트'],
  ['未运行', 'Not running', '停止中', '실행 중 아님'],
  ['错误', 'Error', 'エラー', '오류'],
  ['确定', 'Confirm', '確認', '확인'],
  ['关闭页面切换和滚动中的大部分动画。', 'Disable most page and scrolling animations.', 'ページ切り替えやスクロールのアニメーションを抑えます。', '페이지 전환 및 스크롤 애니메이션 대부분을 끕니다.'],
  ['减少动态效果', 'Reduce motion', '視覚効果を減らす', '동작 효과 줄이기'],
  ['界面语言', 'Interface language', '表示言語', '인터페이스 언어'],
  ['应用菜单、按钮与状态信息所使用的语言。', 'Language used for menus, buttons, and status messages.', 'メニュー、ボタン、状態メッセージに使用する言語です。', '메뉴, 버튼, 상태 메시지에 사용할 언어입니다.'],
  ['管理语言与界面交互偏好。', 'Manage language and interface preferences.', '言語とインターフェースの設定を管理します。', '언어 및 인터페이스 설정을 관리합니다.'],
  ['选择最适合当前环境的界面显示方式。', 'Choose the display mode best suited to your environment.', '現在の環境に適した表示モードを選択します。', '현재 환경에 가장 적합한 표시 모드를 선택합니다.'],
  ['颜色模式', 'Color mode', 'カラーモード', '색상 모드'],
  ['更改后会立即应用到整个应用。', 'Changes apply immediately throughout the app.', '変更はアプリ全体にすぐ適用されます。', '변경 사항은 앱 전체에 즉시 적용됩니다.'],
  ['配置文件已不存在，请重新导入', 'The configuration file no longer exists. Import it again.', '設定ファイルがありません。再インポートしてください。', '설정 파일이 없습니다. 다시 가져오세요.'],
  ['所选配置不存在', 'The selected configuration does not exist', '選択した設定がありません', '선택한 설정이 없습니다'],
  ['保存配置失败', 'Failed to save configuration', '設定を保存できませんでした', '설정을 저장하지 못했습니다'],
  ['删除配置失败', 'Failed to delete configuration', '設定を削除できませんでした', '설정을 삭제하지 못했습니다'],
  ['加载 Java 信息失败', 'Failed to load Java information', 'Java 情報を読み込めませんでした', 'Java 정보를 불러오지 못했습니다'],
  ['操作失败，请稍后重试', 'The operation failed. Try again later.', '操作に失敗しました。後でもう一度お試しください。', '작업에 실패했습니다. 잠시 후 다시 시도하세요.'],
  ['当前配置', 'Current configuration', '現在の設定', '현재 설정'],
  ['配置文件路径', 'Configuration file path', '設定ファイルのパス', '설정 파일 경로'],
  ['打开官网', 'Open website', '公式サイトを開く', '공식 사이트 열기'],
  ['打开官方页面', 'Open official page', '公式ページを開く', '공식 페이지 열기'],
  ['正在读取设备状态...', 'Reading device status...', 'デバイス状態を読み込み中...', '장치 상태 불러오는 중...'],
  ['刷新设备状态', 'Refresh device status', 'デバイス状態を更新', '장치 상태 새로 고침'],
  ['正在读取服务器列表...', 'Loading server list...', 'サーバー一覧を読み込み中...', '서버 목록 불러오는 중...'],
  ['正在连接服务器...', 'Connecting to server...', 'サーバーに接続中...', '서버에 연결하는 중...'],
  ['正在读取版本...', 'Loading versions...', 'バージョンを読み込み中...', '버전 불러오는 중...'],
  ['未连接', 'Not connected', '未接続', '연결되지 않음'],
  ['未检测到', 'Not detected', '未検出', '감지되지 않음'],
  ['未识别', 'Unrecognized', '認識されていません', '인식되지 않음'],
  ['正在下载更新:', 'Downloading update:', 'アップデートをダウンロード中：', '업데이트 다운로드 중:'],
  ['的', "'s", 'の', '의'],
  ['默认头像', 'default avatar', 'デフォルトアバター', '기본 아바타'],
  ['获取服务端列表失败:', 'Failed to load the server list:', 'サーバー一覧を取得できませんでした：', '서버 목록을 불러오지 못했습니다:'],
  ['获取版本失败:', 'Failed to load versions:', 'バージョンを取得できませんでした：', '버전을 불러오지 못했습니다:'],
  ['MSL 开服器', 'MSL Server Launcher', 'MSL サーバーランチャー', 'MSL 서버 런처'],
  ['刷新版本', 'Refresh versions', 'バージョンを更新', '버전 새로 고침'],
  ['台', 'servers', '台', '대'],
  ['SSH 主机指纹 (SHA-256)', 'SSH host fingerprint (SHA-256)', 'SSH ホストフィンガープリント (SHA-256)', 'SSH 호스트 지문 (SHA-256)'],
  ['日志', 'Log', 'ログ', '로그'],
]

const translationMaps: Record<'en' | 'ja' | 'ko', Map<string, string>> = {
  en: new Map(entries.map(([source, en]) => [source, en])),
  ja: new Map(entries.map(([source, _en, ja]) => [source, ja])),
  ko: new Map(entries.map(([source, _en, _ja, ko]) => [source, ko])),
}

const orderedSources = [...new Set(entries.map(([source]) => source))].sort((left, right) => right.length - left.length)
const containsHan = /[\u3400-\u9fff]/

const traditionalPhrases: Array<[string, string]> = [
  ['服务器', '伺服器'], ['软件', '軟體'], ['文件夹', '資料夾'], ['文件', '檔案'], ['信息', '資訊'],
  ['默认', '預設'], ['检测', '偵測'], ['加载', '載入'], ['登录', '登入'], ['账户', '帳號'],
  ['添加', '新增'], ['删除', '刪除'], ['配置', '設定'], ['内存', '記憶體'], ['硬盘', '硬碟'],
  ['网络', '網路'], ['远程', '遠端'], ['本地', '本機'], ['链接', '連結'], ['下载', '下載'],
]

/* Legacy character table retained in source history; runtime conversion uses OpenCC below.
const simplifiedChars = '设置务务务务务务务务为个么义习乡书买乱争于亏云亚产亩亲仅从仓仪们价众优会伞伟传伤伦伪体余侠侣侦侧侨俩俭债倾偿儿兑党兰关兴养兽冈册写军农冯冲决况冻净准凉减凤凭凯击凿刍划刘则刚创删别刹剂剑剧劝办务动励劲劳势勋匀区医华协单卖卢卫却厂厅历厉压厌厕县发变叙叶号叹吓吕吗听启吴呐呕员呛呜咏咙响哑哒哟唤啰啸喷嘱噜团园围国图圆圣场坏块坚坛坝坞坟坠垒垦垫垭垱垲埘埙埚堑墙壮声壳壶处备复够头夸夹夺奋奖奥妆妇妈妩姗姜娄娱婴孙学宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝层屉届属岁岂岗岛岭岳峡崭币帅师帐帘带帮庄庆庐库应庙庞废开异弃张弥弯弹强归当录彦彻径忆忧怀态怂怜总恋恒恳恶恼悦悬惊惧惨惩惫惯愤愿慑懒戏户执扩扫扬扰抚抛护报担拟拢拥择挂挚挛挞挟挥损捡换据掳掸掺揽搀搁搂搅携摄摆摇摊撑撵敌敛数斋斓斗断无旧时旷显晋晒晓晕暂术机杀杂权杆条来杨杰极构枪枣枢枫柜柠查栅标栈栋栏树样栾桢桥桦桨梦检椭楼榄榇榈槛横樱橱橹欢欧歼殁残殒殚殡毁毕毙气汇汉汤沟没沥沦沧沪泞泪泷泸泺泻泽泾洁洒洼浅浆浇浈浊测济浏浑浒浓浔涛涝涟涡涣涤润涧涨涩淀渊渍渐渔渗温湾湿溃溅滚滞满滤滥滨滩潆潇潜澜濒灭灯灵灾灿炉炖点炼炽烁烂烃烧烛烟烦热焕焖爱爷牍牵牺犊状犷犹狈狞独狭狮狰狱猎猪猫献獭玛环现玱电画畅畴疗疟疠疡疮疯痈痉痒瘅瘆瘪瘫瘾瘿癞癣皑皱盏盐监盖盗盘眍着睁睐睑瞒瞩矫矿码砖砚砺础硅硕确碍碛礼祎祢祯祷祸禀离秃秆种积称税稳穷窃窍窑窜窝窥竞笔笋笼筑筛筹签简箓箦篮篱簖籁类粜粝粤粮紧絷纠纡红纣纤约级纪纫纬纭纯纰纱纲纳纵纶纷纸纹纺纽线练组绅细织终绉绊绍绎经绑绒结绕绘给络绝绞统绢绣绦继绩绪续绰绳维绵绷绸综绽绿缀缉缎缓缔缕编缘缚缝缠缤缨缩缪缫缭缴罢罗罚罴羁翘耸耻聂聋职联聪肃肠肤肾肿胀胁胆胜胶脉脏脐脑脓脚脱脸腊腻腼腾膑臜舆舰舱艰艳艺节芜芦苁苇苍苎苏苹范茎茏茧荆荐荡荣荤荥荦荧药莅莱莲莳获莸莺萝萤营萧萨葱蒋蓝蓟蔷蔺蔼蕲蕴薮藓蘖虏虑虚虫虽虾蚀蚁蚂蚕蛊蛎蛮蛰蝈蝉蝼蝾衅补衬袄袜袭装裆裤褛见观规觅视览觉觊觋觌觎觏觐觑角觞触订计认讥讨让讪讫训议讯记讲讳讴讶许讹论讼讽设访诀证评诅识诈诉诊诋词诏译诒诓试诗诚诛话诞诟诠诡询诣该详诧诨诩诫诬语诮误诱诲诳说诵请诸诺读诽课谀谁调谄谅谆谈谊谋谍谎谏谐谑谒谓谚谜谢谣谤谥谦谧谨谩谪谬谭谱谲谴谷贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贷贸费贺贻贼贾贿赁赂赃资赈赊赋赌赎赏赐赔赖赘赚赛赞赠赡赢赵赶趋趱跃跄践跷跸跹跻踊踌踪蹒蹿躏躯车轨轩轫转轮软轰轱轲轳轴轶轸轹轻载轿较辅辆辈辉辊辋辍辎辏辐辑输辔辕辖辗辘辙辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选递逻遗邮邻郁郑酝酱酿释里鉴钆钇针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钹钺钻钼钽钾铀铁铂铃铄铅铆铈铉铊铋铌铍铎铐铑铒铕铖铗铙铛铜铝铠铡铢铣铤铥铧铨铩铪铫铬铭铮铯铰铲铳铴银铷铸铺链铿销锁锂锃锅锆锇锈锉锋锌锐锑锒锓锔锕锖锗错锚锛锜锝锞锟锡锢锣锤锥锦锨锩锪锫锬锭键锯锰锱锲锳锴锵锶锷锸锹锺锻锼锾镀镁镂镇镉镊镌镍镏镐镑镒镓镔镕镖镗镘镙镚镛镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镰镱镲镳镶长门闪闭问闯闰闲间闵闷闸闹闺闻闼闽闾阀阁阂阃阄阅阆阈阉阊阋阌阍阎阐阑阒阔阕阖阗阙队阳阴阵阶际陆陈陉陕陧陨险随隐隶难雏雠雳雾霁霭静韦韩页顶顷项顺须顽顾顿颁颂预颅领颇颈颉颊颌颍颏频颓颔颖颗题颚颛颜额颞颟颠颡颢颤风飏飓飕飘飙飞饥饧饨饭饮饯饰饱饲饴饵饶饷饺饼饿馁馅馆馈馊馋馍馏馐馑馒马驭驮驯驰驱驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骄骅骆骇骈骊骋验骏骐骑骒骓骖骗骘骚骛骜骝骞骟骠骡骤骥骦骨髅髋鬓魇鱼鲁鲂鲅鲆鲇鲈鲋鲍鲎鲐鲑鲒鲔鲕鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲺鲻鲼鲽鳃鳄鳅鳆鳇鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳝鳞鳟鳢鸟鸡鸢鸣鸥鸦鸨鸩鸪鸫鸬鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹎鹏鹑鹕鹗鹘鹚鹛鹜鹞鹣鹤鹦鹧鹨鹩鹪鹫鹬鹭鹰鹱鹳麦麸黄黉齐齿龄龈龊龋龙龟';
const traditionalChars = '設置務務務務務務務務為個麼義習鄉書買亂爭於虧雲亞產畝親僅從倉儀們價眾優會傘偉傳傷倫偽體餘俠侶偵側僑倆儉債傾償兒兌黨蘭關興養獸岡冊寫軍農馮衝決況凍淨準涼減鳳憑凱擊鑿芻劃劉則剛創刪別剎劑劍劇勸辦務動勵勁勞勢勳勻區醫華協單賣盧衛卻廠廳歷厲壓厭廁縣發變敘葉號嘆嚇呂嗎聽啟吳吶嘔員嗆嗚詠嚨響啞噠喲喚囉嘯噴囑嚕團園圍國圖圓聖場壞塊堅壇壩塢墳墜壘墾墊埡壋塏塒塤堝塹牆壯聲殼壺處備復夠頭誇夾奪奮獎奧妝婦媽嫵姍薑婁娛嬰孫學寧寶實寵審憲宮寬賓寢對尋導壽將爾塵嘗層屜屆屬歲豈崗島嶺嶽峽嶄幣帥師帳簾帶幫莊慶廬庫應廟龐廢開異棄張彌彎彈強歸當錄彥徹徑憶憂懷態慫憐總戀恆懇惡惱悅懸驚懼慘懲憊慣憤願懾懶戲戶執擴掃揚擾撫拋護報擔擬攏擁擇掛摯攣撻挾揮損撿換據擄撣摻攬攙擱摟攪攜攝擺搖攤撐攆敵斂數齋斕鬥斷無舊時曠顯晉曬曉暈暫術機殺雜權桿條來楊傑極構槍棗樞楓櫃檸查柵標棧棟欄樹樣欒楨橋樺槳夢檢橢樓欖櫬櫚檻橫櫻櫥櫓歡歐殲歿殘殞殫殯毀畢斃氣匯漢湯溝沒瀝淪滄滬濘淚瀧瀘濼瀉澤涇潔灑窪淺漿澆湞濁測濟瀏渾滸濃潯濤澇漣渦渙滌潤澗漲澀澱淵漬漸漁滲溫灣濕潰濺滾滯滿濾濫濱灘瀅瀟潛瀾瀕滅燈靈災燦爐燉點煉熾爍爛烴燒燭煙煩熱煥燜愛爺牘牽犧犢狀獷猶狽獰獨狹獅猙獄獵豬貓獻獺瑪環現瑲電畫暢疇療瘧癘瘍瘡瘋癰痙癢癉瘮癟癱癮癭癩癬皚皺盞鹽監蓋盜盤瞘著睜睞瞼瞞矚矯礦碼磚硯礪礎矽碩確礙磧禮禕禰禎禱禍稟離禿稈種積稱稅穩窮竊竅窯竄窩窺競筆筍籠築篩籌簽簡籙簀籃籬籪籟類糶糲粵糧緊縶糾紆紅紂纖約級紀紉緯紜純紕紗綱納縱綸紛紙紋紡紐線練組紳細織終縐絆紹繹經綁絨結繞繪給絡絕絞統絹繡絛繼績緒續綽繩維綿繃綢綜綻綠綴緝緞緩締縷編緣縛縫纏繽纓縮繆繅繚繳罷羅罰羆羈翹聳恥聶聾職聯聰肅腸膚腎腫脹脅膽勝膠脈臟臍腦膿腳脫臉臘膩靦騰臏臢輿艦艙艱豔藝節蕪蘆蓯葦蒼苧蘇蘋範莖蘢繭荊薦蕩榮葷滎犖熒藥蒞萊蓮蒔獲蕕鶯蘿螢營蕭薩蔥蔣藍薊薔藺藹蘄蘊藪蘚櫱虜慮虛蟲雖蝦蝕蟻螞蠶蠱蠣蠻蟄蟈蟬螻蠑釁補襯襖襪襲裝襠褲褸見觀規覓視覽覺覬覡覿覦覯覲覷角觴觸訂計認譏討讓訕訖訓議訊記講諱謳訝許訛論訟諷設訪訣證評詛識詐訴診詆詞詔譯詒誆試詩誠誅話誕詬詮詭詢詣該詳詫諢詡誡誣語誚誤誘誨誑說誦請諸諾讀誹課諛誰調諂諒諄談誼謀諜謊諫諧謔謁謂諺謎謝謠謗謚謙謐謹謾謫謬譚譜譎譴穀貝貞負貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貰貼貴貸貿費賀貽賊賈賄賃賂贓資賑賒賦賭贖賞賜賠賴贅賺賽贊贈贍贏趙趕趨趲躍蹌踐蹺蹕躚躋踴躊蹤蹣躥躪軀車軌軒軔轉輪軟轟軲軻轤軸軼軫轢輕載轎較輔輛輩輝輥輞輟輜輳輻輯輸轡轅轄輾轆轍辭辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡適選遞邏輯遺郵鄰鬱鄭醞醬釀釋裡鑒釓釔針釘釗釙釕釷釺釧釤釩釣鍆釹釵鈣鈈鈦鈍鈔鐘鈉鋇鋼鈑鈐鑰欽鈞鎢鉤鈧鈁鈥鉞鈕鈀鈺錢鉦鉗鈷缽鈸鉞鑽鉬鉭鉀鈾鐵鉑鈴鑠鉛鉚鈰鉉鉈鉍鈮鈹鐸銬銠鉺銪鋮鋏鐃鐺銅鋁鎧鍘銖銑鋌銥鏵銓鎩鉿銚鉻銘錚銫鉸鏟銃鐋銀銣鑄鋪鏈鏗銷鎖鋰鋥鍋鋯鋨鏽銼鋒鋅銳銻鋃鋟鋦錒錆鍺錯錨錛錡鍀錁錕錫錮鑼錘錐錦鍁錈鍃錇錟錠鍵鋸錳錙鍥鍈鍶鍔鍤鍬鍾鍛鎪鍰鍍鎂鏤鎮鎘鑷鐫鎳鎦鎬鎊鎰鎵鑌鎔鏢鏜鏝鏍鏰鏞鏡鏑鏃鏇鏐鐔钁鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐮鐿鑔鑣鑲長門閃閉問闖閏閒間閔悶閘鬧閨聞闥閩閭閥閣閡閫鬮閱閬閾閹閶鬩閿閽閻闡闌闃闊闋闔闐闕隊陽陰陣階際陸陳陘陝隉隕險隨隱隸難雛讎靂霧霽靄靜韋韓頁頂頃項順須頑顧頓頒頌預顱領頗頸頡頰頜潁頦頻頹頷穎顆題顎顓顏額顳顢顛顙顥顫風颺颶颼飄飆飛飢餳飩飯飲餞飾飽飼飴餌饒餉餃餅餓餒餡館饋餿饞饃餾饈饉饅馬馭馱馴馳驅駁驢駔駛駟駙駒騶駐駝駑駕驛駘驍罵驕驊駱駭駢驪騁驗駿騏騎騍騅驂騙騭騷騖驁騮騫騸驃騾驟驥驦骨髏髖鬢魘魚魯魴鮁鮃鮎鱸鮒鮑鱟鮐鮭鮚鮪鮞鱭鮫鮮鯗鱘鯁鱺鰱鰹鯉鰣鰷鯀鯊鯇鯽鯖鯪鯫鯡鯤鯧鯝鯢鯰鯛鯨鯴鯔鰳鰈鰓鱷鰍鮒鰉鯿鰠鼇鰭鰨鰥鰩鰳鰾鱈鱉鰻鰵鱅鱖鱔鱗鱒鰱鳥雞鳶鳴鷗鴉鴇鴆鴣鶇鸕鴨鴦鴟鴝鴛鴕鷥鷙鴯鴰鵂鴿鸞鴻鵓鸝鵑鵠鵝鵒鷳鵜鵡鵲鶓鵪鵯鵬鶉鶘鶚鶻鷀鶥鶩鷂鶼鶴鸚鷓鷚鷯鷦鷲鷸鷺鷹鸌鸛麥麩黃黌齊齒齡齦齪齲龍龜';
const traditionalCharMap = new Map<string, string>()
const traditionalCharacterList = [...traditionalChars]
for (const [index, character] of [...simplifiedChars].entries()) {
  if (!traditionalCharMap.has(character)) traditionalCharMap.set(character, traditionalCharacterList[index] || character)
}
*/

const convertTraditionalCharacters = CustomConverter(simplifiedToTraditionalCharacters)

function toTraditional(source: string): string {
  let result = source
  for (const [simplified, traditional] of traditionalPhrases) result = result.split(simplified).join(traditional)
  return convertTraditionalCharacters(result)
}

export function resolveLanguage(preference: LanguagePreference): SupportedLanguage {
  if (preference !== 'system') return preference
  const locale = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase()
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-hant')) return 'zh-TW'
  if (locale.startsWith('zh')) return 'zh-CN'
  if (locale.startsWith('ja')) return 'ja'
  if (locale.startsWith('ko')) return 'ko'
  return 'en'
}

let activeLanguage: SupportedLanguage = 'zh-CN'

export function getActiveLanguage(): SupportedLanguage {
  return activeLanguage
}

export function translate(source: string, language = activeLanguage): string {
  if (!source || language === 'zh-CN') return source
  if (language === 'zh-TW') return toTraditional(source)
  const map = translationMaps[language]
  const exact = map.get(source)
  if (exact) return exact

  let translated = source
  let replaced = false
  for (const candidate of orderedSources) {
    if (!translated.includes(candidate)) continue
    const replacement = map.get(candidate)
    if (!replacement) continue
    translated = translated.split(candidate).join(replacement)
    replaced = true
  }
  return replaced ? translated : source
}

const originalText = new WeakMap<Text, string>()
const appliedText = new WeakMap<Text, string>()
const originalAttributes = new WeakMap<Element, Map<string, string>>()
const appliedAttributes = new WeakMap<Element, Map<string, string>>()
const localizableAttributes = ['aria-label', 'title', 'placeholder'] as const

function shouldSkip(element: Element | null): boolean {
  return Boolean(element?.closest('script, style, code, pre, .terminal, [data-no-localize]'))
}

function translateTextNode(node: Text) {
  if (shouldSkip(node.parentElement)) return
  const current = node.nodeValue || ''
  const lastApplied = appliedText.get(node)
  if (!originalText.has(node) || (lastApplied !== undefined && current !== lastApplied)) originalText.set(node, current)
  const source = originalText.get(node) || current
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/)
  const body = match?.[2] || ''
  if (!body || (!containsHan.test(body) && !entries.some(([candidate]) => body.includes(candidate)))) return
  const next = `${match?.[1] || ''}${translate(body)}${match?.[3] || ''}`
  if (current !== next) node.nodeValue = next
  appliedText.set(node, next)
}

function translateElementAttributes(element: Element) {
  if (shouldSkip(element)) return
  let originals = originalAttributes.get(element)
  let applied = appliedAttributes.get(element)
  if (!originals) {
    originals = new Map()
    originalAttributes.set(element, originals)
  }
  if (!applied) {
    applied = new Map()
    appliedAttributes.set(element, applied)
  }

  for (const attribute of localizableAttributes) {
    const current = element.getAttribute(attribute)
    if (current === null) continue
    const previousApplied = applied.get(attribute)
    if (!originals.has(attribute) || (previousApplied !== undefined && current !== previousApplied)) originals.set(attribute, current)
    const source = originals.get(attribute) || current
    const next = translate(source)
    if (current !== next) element.setAttribute(attribute, next)
    applied.set(attribute, next)
  }
}

function localizeSubtree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const element = root as Element
  translateElementAttributes(element)
  for (const child of Array.from(element.childNodes)) localizeSubtree(child)
}

export function LocalizedDocument({ preference }: { preference: LanguagePreference }) {
  useEffect(() => {
    activeLanguage = resolveLanguage(preference)
    document.documentElement.lang = activeLanguage
    document.title = translate('Minecraft 服务器搭建工具')
    localizeSubtree(document.body)

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target as Text)
        if (mutation.type === 'attributes') translateElementAttributes(mutation.target as Element)
        for (const node of Array.from(mutation.addedNodes)) localizeSubtree(node)
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...localizableAttributes],
    })

    const handleLanguageChange = () => {
      if (preference !== 'system') return
      activeLanguage = resolveLanguage(preference)
      document.documentElement.lang = activeLanguage
      document.title = translate('Minecraft 服务器搭建工具')
      localizeSubtree(document.body)
    }
    window.addEventListener('languagechange', handleLanguageChange)
    return () => {
      observer.disconnect()
      window.removeEventListener('languagechange', handleLanguageChange)
    }
  }, [preference])

  return null
}
