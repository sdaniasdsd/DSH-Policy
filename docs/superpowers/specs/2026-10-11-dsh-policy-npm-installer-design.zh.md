# DSH Policy npm 安装器

[English](2026-10-11-dsh-policy-npm-installer-design.md) | 中文

## 目标

让 Windows x64 用户通过一条 npm 命令启动已发布 DSH Policy 桌面版的安装，不需要安装策略插件，也不将桌面可执行文件放入 npm 压缩包。

## 用户命令

```text
npx --yes @deepseek-ai/dsh-policy install
```

npm 包提供轻量的 `dsh-policy` 命令，不使用 `postinstall` 钩子。显式执行 `install` 时，下载 GitHub Release `policy-v0.2.0` 的 Windows x64 安装包，校验准确字节数和 SHA-256，然后启动现有交互式安装程序。该命令不安装 Node 依赖、不配置模型、不更改 PATH，也不改动已有 DSH 配置。

## 包与产物

- 包名：`@deepseek-ai/dsh-policy`，版本 `0.2.0`。
- npm 压缩包仅包含命令、包元数据及简要使用文档，不包含大小为 286,555,946 字节的安装包。
- 命令使用 `https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v0.2.0/` 下的不可变产物地址，固定 SHA-256 为 `6f9b8a3fee5049cc947628a070cca764c093225ac967d39e2f39e13b2764dcaf`。
- 仅支持 Windows x64；其他系统或架构收到明确的不支持提示和 Release 页面地址。
- 包源码置于 DSH npm 发布族工作区之外，与桌面版同步版本和发布，无需提升全部 DSH 包的版本。

## 下载与启动行为

命令仅接受 `install` 操作及帮助、版本选项。它跟随固定 GitHub 产物的 HTTPS 重定向，拒绝意外主机、HTTP 错误、截断或超长内容以及摘要不匹配，并写入唯一临时目录。校验成功后，继承控制台句柄启动安装程序，保持现有交互界面可用。安装程序退出后清理临时数据，并返回其退出状态。网络或校验错误在启动进程之前终止，并显示可供手动下载的 Release 页面。

## 发布与验证

npm 包版本跟随公开的桌面策略版版本，而非 DSH 核心版本。后续桌面发布须一起更新固定标签、文件名、字节数、SHA-256 和 npm 包版本。发布前使用 `npm pack --dry-run` 检查压缩包；元数据须声明包名、版本和可执行入口，且不包含桌面二进制文件或密钥。发布后读取注册表元数据，确认发布地址及校验和常量与桌面 Release 一致。

## 约束与当前发布权限

用户明确要求提供启动当前桌面版安装的 npm 命令，此要求授权了所需的轻量 npm 可执行入口。实现仍是已校验桌面产物的下载器，不将任务策略改为独立 npm 插件，也不修改 DSH CLI 包。

当前本地 npm 身份为 `zhangzheng22668`。访问 `@deepseek-ai` 组织返回 HTTP 403，`DSH-Policy` GitHub 仓库目前也没有 npm 发布密钥或发布环境。源码及压缩包可以在本地准备；以 `@deepseek-ai` 名义发布需要有该命名空间写权限的发布身份或仓库发布渠道。
