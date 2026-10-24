# DSH 策略管理器

[English](README.md) | 中文

DSH 策略管理器是独立的 Windows 应用，用于管理官方 DSH Desktop 安装、选择官方或策略模式，并在受支持的变更中保留所选 Harness 主目录。

应用使用官方 Desktop 运行时和 profile CLI，不修改 `app.asar`，也不运行第二套 agent 运行时。

Windows 安装检测识别带版本号的官方与 Policy Edition 卸载项，验证可执行文件，并按标准 Electron ASAR 格式读取 Desktop 与 DSH 身份。首页列出两个版本的路径、版本号和提交。默认选中唯一的官方安装，用户明确选择的安装会保留。官方运行时身份缺失或不可读时禁用增强包激活，带有未提交改动的构建不兼容增强包。内置策略的整合版会单独标识，不能通过移除独立增强包变成官方安装。

Harness 主目录优先使用显式 `DSH_HOME`；否则在 `%USERPROFILE%\.dsh` 与旧版 Policy Edition 的 `%USERPROFILE%\.dsh-policy` 中复用唯一一个有数据的目录。两个目录都有数据时，管理器会让用户选择，不会合并会话。每次切换前创建 Windows DPAPI 加密备份，恢复前验证内容，并先写入新目录；验证失败时原备份和当前主目录保持完整。转换日志会在下一步变更前同步写入不可变阶段记录。

备份会跳过 `node_modules` 目录和目录链接，因为 DSH 可以重新生成这些依赖。其他符号链接和不支持的文件系统项仍会阻止备份，避免跟随链接读取目录外的数据。

模式切换通过已安装 Desktop 自带的 DSH CLI 执行，使用独立参数数组和用户选择的 `DSH_HOME`。策略模式从固定仓库下载精确版本的扩展 tarball，按签名目录校验 SHA-256 和大小，备份共享主目录，再让官方 CLI 从已校验的本地归档安装，随后核验包名、版本和运行时元数据。官方模式只移除这个包。未初始化或被锁定的 desktop profile、正在运行的 DSH Desktop 都会阻止变更；操作失败时恢复切换前的加密主目录备份。

版本页在启动时自动读取 `sdaniasdsd/DSH-Policy` 的公开发行记录，并把整合版安装包与独立扩展 tarball 分开展示。公开发布信息仅用于发现；只有管理器签名目录能建立扩展兼容关系或授权安装。读取失败会明确显示并提供重试，已成功检测的本机状态会保留。

首页和版本页的选包指南会说明当前管理目标，并提供正式策略整合包或精确兼容的增强包。整合包已包含应用，无需另装官方版本。推荐按语义版本比较，排除预览版及文件名版本不符的安装包，不改变管理目标。`catalog/policy-bases.json` 保存已审计策略发行版声明的官方基线及固定提交的源码依据，未经验证的官方提交保持未知。此映射只用于说明历史基线，不能授予增强包兼容资格；未知发行版或来源提交冲突时不提供该映射。

刷新签名目录时先验签再缓存，下次启动重新验签。启动操作会应用选中的官方配置模式，或直接启动所选策略整合版而不修改其配置，两者均使用选定的 `DSH_HOME`。恢复备份前，会先为当前主目录创建新的加密快照。已验证的官方版本升级前，管理器会保存可跨重启读取的恢复描述符；事务中断后，活动页提供恢复旧版及升级前主目录的操作。

安装包只能从官方 HTTPS 主机下载，先写入临时文件并核验目录中的 SHA-256，启动安装前再核验一次。安装参数固定为内置 NSIS 静默参数，且会等待 Desktop 完全退出。恢复要求旧版与签名目录精确匹配；若本机缓存缺少旧安装包，会重新下载并验证，然后安装旧版、检查内置 DSH 版本和 commit，再恢复加密主目录备份。恢复失败或版本不匹配时会保留备份和当前数据，并将日志标记为需要恢复。

签名目录可分别列出已验证的官方 Windows 安装包和独立扩展。扩展记录绑定 GitHub Release tarball、SHA-256、字节数及精确的内置 DSH 运行时版本/构建提交。包元数据中的 `dshCommit` 是上游源码标签提交；它与用于安装兼容判断的 Desktop 构建提交不同。策略工具提供一个内置工作流，并通过 DSH Jobs 显示阶段和 agent 活动。固定版本的公开 DSH API 仍不支持同一子 agent 续跑、仅向活动成员投递反馈和按子 agent 配置工具沙箱。

## 开发

安装 stable MSVC Rust 工具链、Visual Studio C++ Build Tools 和 WebView2 Runtime。需要刷新 JavaScript 依赖时，在仓库根目录运行 `corepack pnpm install`；workspace 根目录已包含 `apps/*` 包模式。

使用 `npm --prefix apps/policy-manager test` 运行界面测试，使用 `npm --prefix apps/policy-manager run build` 构建界面，使用 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --features app` 运行 Rust 与 IPC 命令测试。

目录签名私钥必须放在仓库之外。只有验证了官方不可变安装包字节和运行时身份后，才能将 `manager-catalog.json` 及其原始 Ed25519 签名作为发行附件发布。
