# DSH Policy 管理器实现计划

[English](2026-10-22-dsh-policy-manager.md) | 中文

> **面向智能体执行者：** 实施本计划时必须使用 `superpowers:executing-plans`，按任务逐项执行。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 构建独立的 Windows Tauri 应用，管理经过验证的官方 DSH Desktop 发行版、精确的 Policy 兼容关系、共享 Harness 数据、模式切换、备份、回退、启动和诊断。

**架构：** 新增独立 workspace 应用 `apps/policy-manager`，采用 React/TypeScript 界面和仅面向 Windows 的 Rust 后端。后端验证签名版本目录，通过随附 Desktop 的 `dsh` 命令操作 profile，并负责安装器、备份和恢复事务；它绝不修改 `app.asar` 或运行替代 Agent 运行时。

**技术栈：** Tauri 2、Rust、React、TypeScript、Vite、Vitest、Cargo 测试和 Windows DPAPI。

**规格：** [DSH Policy 管理器与版本管理](../specs/2026-10-22-dsh-policy-manager-design.zh.md)

## 全局约束

- 首版面向 Windows x64 和唯一活动的官方 DSH Desktop 安装。
- 将 Desktop 包版本与内置 DSH 运行时版本及上游提交分别作为独立身份。
- 只有运行时版本和提交都精确匹配时才启用 Policy 模式；否则只允许官方模式。
- 各模式和受支持发行版共用所选 `DSH_HOME`；变更前创建并验证本地加密备份。
- 使用官方 Desktop `dsh` 命令和 profile Bundle 路径；绝不修改 `app.asar`、注入渲染器代码或替换官方运行时。
- 安装前验证签名版本目录和安装包 SHA-256；只有来源为第一方、行为已知且已列入目录的包才可安装。
- 保留最后一个已验证安装包和 Harness 主目录恢复点；失败或中断后绝不启动未经验证的安装。
- 从诊断信息中移除凭据、授权头和包含密钥的命令参数。
- 当前 Windows 开发机已通过官方 rustup 配置 stable MSVC Rust 工具链，并检测到 Visual Studio C++ Build Tools；运行打包后的管理器还需要 WebView2。

## 评审关注点

- 版本目录缺失、格式错误、过期或签名错误时，必须禁用安装和策略模式，同时不阻止安全地以官方模式启动；任务 1 为 parser 和界面状态编写测试。
- Desktop 版本对应的 DSH 版本或提交不匹配时，绝不能启用相邻 Policy 发行版；任务 1 和任务 5 锁定精确配对拒绝行为。
- 标准主目录和旧 Policy 主目录都含数据时，必须保留两份快照并要求用户明确选择主目录；任务 3 锁定初始化和备份行为。
- DSH、其 profile 包操作或另一项管理器事务可能仍在运行；任务 3–5 锁定锁冲突处理和不变更行为。
- 下载、安装器、profile 操作或进程中断可能留下部分变更；任务 4 锁定恢复到先前已验证版本和快照的行为。

---

### 任务 1：管理器脚手架与可信版本目录

**文件：**
- 新建：`apps/policy-manager/package.json`
- 新建：`apps/policy-manager/index.html`
- 新建：`apps/policy-manager/vite.config.ts`
- 新建：`apps/policy-manager/tsconfig.json`
- 新建：`apps/policy-manager/src/main.tsx`
- 新建：`apps/policy-manager/src/App.test.tsx`
- 新建：`apps/policy-manager/src/App.tsx`
- 新建：`apps/policy-manager/src-tauri/Cargo.toml`
- 新建：`apps/policy-manager/src-tauri/build.rs`
- 新建：`apps/policy-manager/src-tauri/tauri.conf.json`
- 新建：`apps/policy-manager/src-tauri/src/main.rs`
- 新建：`apps/policy-manager/src-tauri/src/lib.rs`
- 新建：`apps/policy-manager/src-tauri/src/catalog.rs`
- 新建：`apps/policy-manager/src-tauri/src/catalog_update.rs`
- 新建：`apps/policy-manager/src-tauri/tests/catalog.rs`
- 新建：`apps/policy-manager/src-tauri/tests/catalog_update.rs`
- 新建：`apps/policy-manager/catalog/releases.json`
- 新建：`apps/policy-manager/catalog/README.md`
- 新建：`apps/policy-manager/catalog/README.zh.md`
- 新建：`apps/policy-manager/README.md`
- 新建：`apps/policy-manager/README.zh.md`
- 修改：仅当现有 `apps/*` workspace glob 不包含新包时修改 `pnpm-workspace.yaml`。

**接口：**
- 产出：Rust `ReleaseCatalog::verify(bytes: &[u8], signature: &[u8], public_key: &[u8; 32]) -> Result<ReleaseCatalog, CatalogError>` 和 `ReleaseCatalog::policy_for(runtime_version: &str, runtime_commit: &str) -> Option<&PolicyRelease>`。
- 产出：公开的 `DesktopRelease` 和 `PolicyRelease` 结构体，其字段与下方列出的签名目录记录字段一致。
- 产出：异步 `CatalogClient::refresh(current: Option<&ReleaseCatalog>) -> Result<ReleaseCatalog, CatalogUpdateError>`；它只从 `https://github.com/sdaniasdsd/DSH-Policy/releases/download/dsh-policy-manager-catalog/` 获取 `manager-catalog.json` 及其独立签名，验证签名并拒绝低于当前已加载目录的版本号。
- 发行版记录包含操作系统、架构、Desktop 版本、DSH 版本、DSH 提交、第一方安装包 URL、SHA-256、安装器参数配置和精确的 Policy 包映射。仓库中的开发清单可以为空且不带签名；发布目录必须使用管理器内嵌公钥验证独立的 Ed25519 签名。
- 初始目录只包含第一方来源、不可变字节、哈希、运行时身份和安装器行为均已验证的包；其他核心标签仅显示为不可用的元数据或直接省略。

- [ ] **步骤 1：编写失败的 Rust 版本目录测试**，覆盖有效签名数据、签名错误、字段格式错误、目录过期、不支持的架构、缺少哈希、重复 Desktop 身份、精确 Policy 匹配和运行时提交不匹配；编写目录更新测试，覆盖重定向到未批准 GitHub 主机、替换目录签名错误和拒绝降低版本号；再添加失败的 `App.test.tsx` 初始外壳冒烟测试。
- [ ] **步骤 2：添加最小 Tauri/Vite 测试环境和仅供编译的 Rust API stub**，使测试目标可执行；运行两个 Cargo 集成测试目标和 Vitest，并确认行为断言因有效目录验证、精确匹配、目录刷新和初始页面标题尚未实现而失败。
- [ ] **步骤 3：实现目录解析、Ed25519 签名验证和目录刷新**；应用只内嵌目录验证公钥，签名私钥留在仓库之外。
- [ ] **步骤 4：验证第一方安装包来源、更新 feed 字段、稳定下载字节、SHA-256、内置 DSH 身份和受支持的安装器参数**后，才添加可安装条目；在目录 README 中记录尚未解决的归档行为。实现期间不创建生产签名密钥；在文档中说明发行密钥配置要求。
- [ ] **步骤 5：运行 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test catalog`、`cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test catalog_update` 和 `npm --prefix apps/policy-manager test`**；预期目录测试和初始 React 外壳测试通过。
- [ ] **步骤 6：提交**为 `feat: scaffold DSH policy manager and release catalog`。

### 任务 2：已安装 Desktop 检测与管理器状态

**文件：**
- 新建：`apps/policy-manager/src-tauri/src/installed_dsh.rs`
- 新建：`apps/policy-manager/src-tauri/src/manager_state.rs`
- 新建：`apps/policy-manager/src-tauri/tests/installed_dsh.rs`
- 新建：`apps/policy-manager/src-tauri/tests/manager_state.rs`
- 修改：`apps/policy-manager/src-tauri/src/lib.rs`

**接口：**
- 使用：任务 1 的 `ReleaseCatalog` 和可信目录解析器。
- 产出：`InstalledDsh::detect(registry: &dyn InstallRegistry) -> Result<Option<InstalledDsh>, DetectError>` 和 `ManagerState::inspect(installed: Option<InstalledDsh>, home: PathBuf, profile: ProfileSnapshot, catalog: &ReleaseCatalog) -> ManagerState`。
- `InstalledDsh` 在可读取时保存安装路径、Desktop 版本、内置 DSH 版本和提交；`ManagerState` 独立报告官方/策略模式和精确兼容状态。

- [ ] **步骤 1：编写失败测试**，覆盖未安装、有效注册表安装、可执行文件缺失、运行时身份无法读取、外部升级后的运行时，以及精确和不匹配的 Policy 兼容关系。
- [ ] **步骤 2：运行 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test installed_dsh` 和 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test manager_state`**，确认实现前新测试失败。
- [ ] **步骤 3：实现基于 Windows 注册表的安装检测和只读内置运行时身份识别**，不写入安装目录或 `app.asar`。
- [ ] **步骤 4：实现管理器状态计算**，使不受支持或未知的安装仍可在已验证的官方模式中启动，并禁用 Policy 模式。
- [ ] **步骤 5：运行定向 Cargo 测试**，预期安装检测和兼容性案例全部通过。
- [ ] **步骤 6：提交**为 `feat: detect DSH desktop and policy compatibility`。

### 任务 3：共享 Harness 主目录、加密备份和事务日志

**文件：**
- 新建：`apps/policy-manager/src-tauri/src/harness_home.rs`
- 新建：`apps/policy-manager/src-tauri/src/backup.rs`
- 新建：`apps/policy-manager/src-tauri/src/transaction.rs`
- 新建：`apps/policy-manager/src-tauri/tests/harness_home.rs`
- 新建：`apps/policy-manager/src-tauri/tests/backup.rs`
- 新建：`apps/policy-manager/src-tauri/tests/transaction.rs`
- 修改：`apps/policy-manager/src-tauri/src/lib.rs`

**接口：**
- 产出：`HarnessHome::resolve(explicit: Option<PathBuf>, user_profile: &Path) -> HomeResolution`、`BackupStore::create(home: &Path) -> Result<BackupRecord, BackupError>`、`BackupStore::restore(record: &BackupRecord, destination: &Path) -> Result<(), BackupError>` 和 `TransitionJournal::advance(operation_id: Uuid, stage: TransitionStage) -> Result<(), JournalError>`。
- 备份文件使用有版本号的归档格式并通过 Windows DPAPI 加密，清单包含源路径、创建时间和归档摘要。
- 每次安装/profile 变更前都先持久化事务阶段，并区分 prepared、backed-up、installing、profile-updating、verifying、committed、recovering 和 recovery-required 状态。

- [ ] **步骤 1：编写失败测试**，覆盖显式 `DSH_HOME`、标准主目录回退、两个旧主目录都含数据、归档篡改、DPAPI 往返、日志写入中断和非法阶段跳转。
- [ ] **步骤 2：运行 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test harness_home`、`cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test backup` 和 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test transaction`**，确认实现前测试失败。
- [ ] **步骤 3：实现主目录选择和备份加密**，通过平台抽象提供可确定的测试加密，生产环境使用 Windows DPAPI。
- [ ] **步骤 4：实现原子日志持久化和恢复状态解析**；恢复数据不完整时绝不删除或覆盖唯一已验证备份。
- [ ] **步骤 5：在 Windows 上运行定向 Cargo 测试**，预期主目录选择、加密恢复和中断日志恢复测试通过。
- [ ] **步骤 6：提交**为 `feat: add encrypted DSH home backups and transition journal`。

### 任务 4：安装包验证、安装替换和回退

**文件：**
- 新建：`apps/policy-manager/src-tauri/src/installer.rs`
- 新建：`apps/policy-manager/src-tauri/src/recovery.rs`
- 新建：`apps/policy-manager/src-tauri/tests/installer.rs`
- 新建：`apps/policy-manager/src-tauri/tests/recovery.rs`
- 修改：`apps/policy-manager/src-tauri/src/lib.rs`

**接口：**
- 使用：任务 1–3 的目录、已安装状态、备份和日志接口。
- 产出：`InstallerManager::stage(release: &DesktopRelease) -> Result<VerifiedInstaller, InstallError>`、`InstallerManager::install(installer: &VerifiedInstaller) -> Result<(), InstallError>` 和 `RecoveryManager::recover(snapshot: &RecoverySnapshot) -> Result<ManagerState, RecoveryError>`。
- 安装器参数按已验证的安装器类型从应用内允许列表选择；目录记录不能提供任意可执行参数。

- [ ] **步骤 1：编写失败测试**，覆盖 HTTPS 主机限制、哈希错误、下载不完整、缓存损坏、检测到 Desktop 正在运行、允许的安装器参数、安装失败补偿和缓存缺少安装包时的回退。
- [ ] **步骤 2：运行 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test installer` 和 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test recovery`**，确认实现前测试失败。
- [ ] **步骤 3：实现暂存下载和 SHA-256 验证**；在暂存文件验证前不开始安装或修改 Harness 主目录。
- [ ] **步骤 4：实现 Windows 安装器调用和恢复**，使用已验证的上一版本安装包和变更前备份；补偿失败时进入 recovery-required 状态，绝不启动未经验证的安装。
- [ ] **步骤 5：用模拟安装器运行定向 Cargo 测试**，预期失败和中断事务恢复到上一个已验证状态，或明确进入可恢复状态。
- [ ] **步骤 6：提交**为 `feat: install verified DSH releases with rollback`。

### 任务 5：通过随附 DSH CLI 切换官方和策略模式

**文件：**
- 新建：`apps/policy-manager/src-tauri/src/profile_mode.rs`
- 新建：`apps/policy-manager/src-tauri/tests/profile_mode.rs`
- 修改：`apps/policy-manager/src-tauri/src/lib.rs`
- 修改：`apps/policy-manager/src-tauri/src/transaction.rs`

**接口：**
- 使用：任务 1–4 的 `InstalledDsh`、`ReleaseCatalog`、`HarnessHome`、`BackupStore` 和 `TransitionJournal`。
- 产出：`ProfileModeManager::apply(target: Mode, installation: &InstalledDsh, home: &Path) -> Result<ModeChangeResult, ModeChangeError>`。
- 管理器通过参数数组调用随 Desktop 安装的 CLI，执行等价于 `dsh plugin --profile desktop add @deepseek-ai/dsh-policy-extension@<exact-version>`、`list` 和 `remove` 的命令；传入所选 `DSH_HOME`，不使用 shell，并从输出中移除密钥信息。

- [x] **步骤 1：编写失败测试**，覆盖精确版本的 Policy 添加、官方模式移除、状态已正确、运行时不匹配、profile 未初始化、profile 锁正在使用、CLI 超时和非零退出。
- [x] **步骤 2：运行 `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test profile_mode`**，并确认实现前测试按预期失败。
- [x] **步骤 3：实现类型化进程运行器**，通过参数数组调用随 Desktop 安装的 Electron CLI，不使用 shell 拼接或未经验证的包版本。
- [x] **步骤 4：将模式变更实现为带日志事务**，先备份，再读取实际插件状态，只执行必要的 CLI 变更，最后重新读取 profile 状态再报告成功。
- [x] **步骤 5：11 项模式测试通过；本机未注册 DSH Desktop，因此无法执行已安装实例冒烟测试。**
- [x] **步骤 6：提交**为 `feat: switch official and policy DSH modes`。

### 任务 6：管理器界面与安全启动

**文件：**
- 新建：`apps/policy-manager/src/views/HomePage.tsx`
- 新建：`apps/policy-manager/src/views/VersionsPage.tsx`
- 新建：`apps/policy-manager/src/views/PolicyPage.tsx`
- 新建：`apps/policy-manager/src/views/ActivityPage.tsx`
- 新建：`apps/policy-manager/src/App.test.tsx`
- 新建：`apps/policy-manager/src/components/CompatibilityStatus.tsx`
- 新建：`apps/policy-manager/src/components/OperationProgress.tsx`
- 新建：`apps/policy-manager/src-tauri/src/commands.rs`
- 新建：`apps/policy-manager/src-tauri/src/launcher.rs`
- 新建：`apps/policy-manager/src-tauri/tests/launcher.rs`
- 修改：`apps/policy-manager/src/App.tsx`
- 修改：`apps/policy-manager/src-tauri/src/lib.rs`

**接口：**
- 使用：任务 1–5 的类型化管理器状态和操作。
- 产出：Tauri 命令 `get_manager_state`、`list_releases`、`set_mode`、`install_release`、`list_backups`、`restore_backup`、`launch_dsh`、`get_activity` 和可跨重启调用的 `recover_transition`。
- 产出：`refresh_catalog` 命令，分别报告已验证版本目录更新和 DSH 安装包更新。
- 界面提供首页、版本、策略和操作记录；兼容性未知时禁用策略模式，同时保持官方启动操作可用。

- [x] **步骤 1：编写失败的 React 测试**，覆盖运行时与兼容状态、策略模式不可用、模式切换、版本列表和操作记录。
- [x] **步骤 2：运行 `npm --prefix apps/policy-manager test`**，并确认实现前测试按预期失败。
- [x] **步骤 3：实现类型化 Tauri 命令适配器和启动器**，在 profile 状态验证后，以所选 `DSH_HOME` 启动官方 Desktop 可执行文件和对应模式。
- [x] **步骤 4：按照仓库现有 React/Vite 约定实现四个页面**，所有文件、进程和安装器操作都留在 Rust 后端。
- [x] **步骤 5：4 项 React 测试、63 项 Rust/Tauri 测试、Tauri app 检查、前端生产构建和后台启动冒烟测试均通过。**
- [x] **步骤 6：提交**为 `feat: add DSH policy manager interface and launcher`。

### 任务 7：发行包、可信目录发布和端到端恢复验证

**文件：**
- 新建：`apps/policy-manager/src-tauri/capabilities/default.json`
- 新建：`.github/workflows/policy-manager-windows.yml`
- 新建：`apps/policy-manager/tests/windows-manager-smoke.ps1`
- 新建：`apps/policy-manager/tests/fixtures/catalog/`
- 新建：`apps/policy-manager/src-tauri/tests/recovery_descriptor.rs`
- 修改：`apps/policy-manager/package.json`
- 修改：`apps/policy-manager/src-tauri/src/commands.rs`
- 修改：`apps/policy-manager/src/views/ActivityPage.tsx`
- 修改：`apps/policy-manager/src/App.test.tsx`
- 修改：`apps/policy-manager/src-tauri/tauri.conf.json`
- 修改：`apps/policy-manager/README.md`
- 修改：`apps/policy-manager/README.zh.md`

**接口：**
- 使用：任务 1–6 的打包管理器和版本目录。
- 产出：Windows x64 管理器安装包及目录发布工作流；工作流通过受保护的发行密钥为目录字节签名，私钥绝不存储在仓库或随应用发布。
- 打包冒烟测试使用一次性的 `DSH_HOME` 和 `LOCALAPPDATA` 启动管理器，再通过模拟安装器运行事务场景；绝不替换用户已安装 DSH，也不读取真实凭据。

- [x] **步骤 1：编写失败的打包与恢复检查**，覆盖无签名目录拒绝、签名密钥不匹配、空目录与不支持的发行记录、隔离启动、中断事务持久化和活动页恢复按钮。
- [x] **步骤 2：先运行新增检查**；活动页恢复按钮在接入前按预期失败；签名与发行检查在加入工具前也按预期失败。
- [x] **步骤 3：添加最小权限 Tauri 能力和 Windows CI**，运行前端与 Cargo 测试、打包管理器、受保护目录签名和文件哈希；发行发布需先通过验证，并拒绝空目录。
- [x] **步骤 4：实现隔离的管理器打包启动冒烟及模拟事务场景**，覆盖备份、模式切换、外部安装检测、回退和管理器重启。本机没有已注册的官方 DSH Desktop，因此无法执行真实安装实例升级。
- [x] **步骤 5：运行管理器测试与生产构建**：UI 5/5、发行资格 8/8、Rust/Tauri 77/77、`cargo check`、Vite 生产构建、NSIS 打包和隔离 Windows 启动冒烟全部通过。`corepack pnpm --filter ... test` 被既有根目录 `node_modules` junction 与 pnpm unsafe task-state-path 检查阻止；`doc-sync` 有无关基线失败（29 通过、13 失败），未修改无关文件。
- [x] **步骤 6：提交**为 `test: qualify DSH policy manager Windows release`。

## 计划时记录的来源核实

官方 [DeepSeek 下载页](https://www.deepseek.com/en/download/) 提供当前 macOS 和 Windows 下载入口；Windows 链接指向会变化的 `dsh-latest-windows-x64.exe`。官方 [DSH GitHub 发行页](https://github.com/deepseek-ai/deepseek-harness/releases) 发布的是核心标签与提交，它们本身不能证明对应的 Desktop 安装包。现有 `apps/desktop/scripts/desktop-auto-update-environment.mjs` 将更新 feed 指向 `https://download.deepseek.com/dsh-desk/feeds/win-x64/`。任务 1 必须核实生产 feed 是否保留发行包以及安装器行为后再填写历史可安装条目；如果 feed 没有可验证的不可变安装包，目录只提供本机缓存或通过其他官方第一方来源验证过的发行包。
