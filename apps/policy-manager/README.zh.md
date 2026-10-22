# DSH 策略管理器

[English](README.md) | 中文

DSH 策略管理器是独立的 Windows 应用，用于管理官方 DSH Desktop 安装、选择官方或策略模式，并在受支持的变更中保留所选 Harness 主目录。

应用使用官方 Desktop 运行时和 profile CLI，不修改 `app.asar`，也不运行第二套 agent 运行时。

Windows 安装检测会读取官方卸载注册表项并确认已安装的可执行文件存在，同时只读解析应用 ASAR 中的 Desktop 与 DSH 包身份。运行时身份缺失或无法读取时，仍可使用官方模式，但策略模式会关闭；只有已验证目录中的运行时版本和 commit 完全匹配时才开放策略模式。带有未提交改动标记的构建不兼容策略。

Harness 主目录优先使用显式 `DSH_HOME`；否则在 `%USERPROFILE%\.dsh` 与旧版 Policy Edition 的 `%USERPROFILE%\.dsh-policy` 中复用唯一一个有数据的目录。两个目录都有数据时，管理器会让用户选择，不会合并会话。每次切换前创建 Windows DPAPI 加密备份，恢复前验证内容，并先写入新目录；验证失败时原备份和当前主目录保持完整。转换日志会在下一步变更前同步写入不可变阶段记录。

模式切换通过已安装 Desktop 自带的 DSH CLI 执行，使用独立参数数组和用户选择的 `DSH_HOME`。策略模式只安装精确兼容的 `@deepseek-ai/dsh-policy-extension` 版本；官方模式只移除这个包。未初始化或被锁定的 desktop profile、正在运行的 DSH Desktop 都会阻止变更。每次变更后都会重新检查 profile；操作失败时恢复切换前的加密主目录备份。

安装包只能从官方 HTTPS 主机下载，先写入临时文件并核验目录中的 SHA-256，启动安装前再核验一次。安装参数固定为内置 NSIS 静默参数，且会等待 Desktop 完全退出。恢复要求旧版与签名目录精确匹配；若本机缓存缺少旧安装包，会重新下载并验证，然后安装旧版、检查内置 DSH 版本和 commit，再恢复加密主目录备份。恢复失败或版本不匹配时会保留备份和当前数据，并将日志标记为需要恢复。

版本目录只接受未过期的签名记录，记录必须包含官方 Windows x64 安装包、SHA-256、内置 DSH 版本与提交，以及精确的策略兼容关系。目前没有经过验证、可用于分发的不可变官方 Desktop 安装包，因此仓库中的开发目录为空；配置精确的运行时兼容关系和目录签名公钥前，策略模式保持不可用。

## 开发

安装 stable MSVC Rust 工具链、Visual Studio C++ Build Tools 和 WebView2 Runtime。需要刷新 JavaScript 依赖时，在仓库根目录运行 `corepack pnpm install`；workspace 根目录已包含 `apps/*` 包模式。

使用 `npm --prefix apps/policy-manager test` 运行界面测试，使用 `npm --prefix apps/policy-manager run build` 构建界面，使用 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml` 运行 Rust 测试。

目录签名私钥必须放在仓库之外。只有验证了官方不可变安装包字节和运行时身份后，才能将 `manager-catalog.json` 及其原始 Ed25519 签名作为发行附件发布。
