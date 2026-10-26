# 版本目录

[English](README.md) | 中文

仓库中的 JSON 是未签名的开发清单，不能作为安装来源。每次发布目录都必须递增 `catalogRevision`；`expiresAt` 使用 Unix 秒数。`desktopReleases` 记录经过验证的官方桌面安装包；`policyExtensions` 独立记录策略扩展 tarball、SHA-256、大小和精确的内置 DSH 运行时版本/构建提交。因此没有已验证官方桌面安装器时，管理器仍可为已安装且精确匹配的官方 DSH 加载扩展。

管理器从专用的 `dsh-policy-manager-catalog` GitHub Release 获取 `manager-catalog.json`，不依赖可能属于 Policy Bundle 的仓库“最新发行版”。所有构建都从 `catalog/public-key.hex` 固定读取同一 Ed25519 验证公钥，并且只接受当前未超过 `expiresAt` 的目录。独立 `.sig` 附件保存对目录原始字节签名得到的 64 字节数据。签名私钥只存放在 GitHub Actions Secret `DSH_POLICY_CATALOG_SIGNING_KEY` 中，不得进入本仓库或用户可见的诊断信息。

不能仅因为 GitHub Release tag 或包内 `engines.dsh` 声明就添加发行记录。扩展记录必须指向 `sdaniasdsd/DSH-Policy` 中版本固定的 GitHub Release 资产；发布流水线下载资产，重算 SHA-256 与大小，检查包名、版本、目标运行时提交和无安装生命周期脚本。只有签名目录中的扩展映射可授权管理器安装。`dshCommit` 是官方上游源码 tag 提交，`runtimeCommit` 是用户桌面内置 DSH 构建提交，两者不得混用。
