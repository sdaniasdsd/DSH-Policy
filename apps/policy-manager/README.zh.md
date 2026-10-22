# DSH 策略管理器

[English](README.md) | 中文

DSH 策略管理器是独立的 Windows 应用，用于管理官方 DSH Desktop 安装、选择官方或策略模式，并在受支持的变更中保留所选 Harness 主目录。

应用使用官方 Desktop 运行时和 profile CLI，不修改 `app.asar`，也不运行第二套 agent 运行时。

版本目录只接受未过期的签名记录，记录必须包含官方 Windows x64 安装包、SHA-256、内置 DSH 版本与提交，以及精确的策略兼容关系。目前没有经过验证、可用于分发的不可变官方 Desktop 安装包，因此仓库中的开发目录为空；配置精确的运行时兼容关系和目录签名公钥前，策略模式保持不可用。

## 开发

安装 stable MSVC Rust 工具链、Visual Studio C++ Build Tools 和 WebView2 Runtime。需要刷新 JavaScript 依赖时，在仓库根目录运行 `corepack pnpm install`；workspace 根目录已包含 `apps/*` 包模式。

使用 `npm --prefix apps/policy-manager test` 运行界面测试，使用 `npm --prefix apps/policy-manager run build` 构建界面，使用 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml` 运行 Rust 版本目录测试。

目录签名私钥必须放在仓库之外。只有验证了官方不可变安装包字节和运行时身份后，才能将 `manager-catalog.json` 及其原始 Ed25519 签名作为发行附件发布。
