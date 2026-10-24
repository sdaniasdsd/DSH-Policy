import type {
  DesktopRelease,
  GithubPolicyExtensionRelease,
  GithubReleaseIndex,
  ManagerSnapshot,
} from '../manager-types'
import { isPrereleaseVersion } from '../install-recommendation'

export function VersionsPage({
  releases,
  state,
  github,
  githubBusy,
  githubError,
  onRefreshGithub,
  onOpenGithub,
  onInstall,
  onRefresh,
  busy,
  catalogStatus,
}: {
  releases: DesktopRelease[]
  state: ManagerSnapshot
  github: GithubReleaseIndex | null
  githubBusy: boolean
  githubError: string | null
  onRefreshGithub: () => void
  onOpenGithub: (url: string) => void
  onInstall: (version: string) => void
  onRefresh: () => void
  busy: boolean
  catalogStatus: string
}) {
  const catalogMessage = catalogStatus
    .replace('This manager build has no catalog trust key; signed releases are unavailable.', '此管理器版本尚未配置目录信任密钥，暂时无法验证签名版本。')
    .replace('This manager build has no catalog trust key; cached releases cannot be verified.', '此管理器版本尚未配置目录信任密钥，无法验证缓存的版本。')
    .replace('No verified catalog has been loaded; refresh the signed release catalog.', '尚未加载已验证的版本目录，请刷新签名目录。')
    .replace('The cached release catalog is invalid; refresh it.', '缓存的版本目录无效，请刷新目录。')
    .replace('The cached release catalog failed signature, expiry, or revision checks.', '缓存的版本目录未通过签名、有效期或版本号检查。')
    .replace(/^Verified catalog revision (\d+)\.$/, '已验证版本目录（版本 $1）。')
    .replace(/^Verified cached catalog revision (\d+)\.$/, '已验证缓存的版本目录（版本 $1）。')
  const installedVersion = state.installationEdition === 'official' ? state.installed?.desktopVersion : null
  const extensions = github?.policyExtensions ?? []
  return (
    <section className="page-stack" aria-labelledby="versions-heading">
      <div className="page-heading"><div><p className="eyebrow">发布与安装</p><h2 id="versions-heading">DSH 版本</h2><p className="muted">关联本机版本，查看策略整合版发布和官方签名安装目录。</p></div></div>
      <section className="page-stack" aria-labelledby="github-heading">
        <div className="page-heading section-heading"><div><h3 id="github-heading">GitHub 策略整合版发布</h3><p className="muted">来源仓库：<strong>{github?.repository ?? 'sdaniasdsd/DSH-Policy'}</strong></p><p className="muted">{github ? `上次成功检查：${new Date(github.checkedAt * 1000).toLocaleString('zh-CN')}` : '正在读取公开发布信息。'}</p></div><button className="button" onClick={onRefreshGithub} disabled={githubBusy}>{githubBusy ? '正在读取 GitHub…' : '刷新 GitHub 发布'}</button></div>
        <p className="muted source-note">策略整合版作为独立应用分发。下载后请自行运行安装包；官方基线只说明历史来源，不是增强包兼容承诺，也不提供官方签名目录的自动安装资格。</p>
        {githubError && <div className="operation-note operation-note--error read-error" role="alert"><span>GitHub 发布读取失败：{githubError}{github ? '；保留上次成功读取的发布信息。' : '；本机检测仍可使用。'}</span><button className="button" onClick={onRefreshGithub} disabled={githubBusy}>重试 GitHub 发布</button></div>}
        {githubBusy && <p className="muted" role="status">正在检查 GitHub 发布，不影响本机安装检测。</p>}
        {github?.releases.length ? <div className="release-list">{github.releases.map((release) => {
          const associated = state.installationEdition === 'policy' && state.installed?.desktopVersion === release.version
          const commitMatches = associated
            && Boolean(release.sourceCommit)
            && release.sourceCommit === state.installed?.runtimeCommit
            && !state.installed?.buildDirty
          return <article className="card release-row" key={release.tag}>
            <div className="release-main"><div><h3>{release.name || `策略整合版 ${release.version}`}</h3><p className="muted">标签 {release.tag}{release.prerelease || isPrereleaseVersion(release.version) ? ' · 预发布' : ' · 正式发布'}{release.publishedAt ? ` · ${new Date(release.publishedAt).toLocaleDateString('zh-CN')}` : ''}</p></div></div>
            {associated && <div className="release-association"><span className="tag tag--soft">已安装策略整合版 · 版本标签对应</span><span className="tag">{commitMatches ? '构建来源提交匹配' : '构建来源待核验'}</span></div>}
            {release.officialBase ? <div className="official-base"><strong>{release.officialBase.verification === 'declared' ? '声明基于官方 DSH ' : '基于官方 DSH '}{release.officialBase.version}</strong><details><summary>官方基线详情</summary><p className="muted">官方标签 {release.officialBase.tag}</p><p className="muted release-hash">{release.officialBase.verification === 'declared' || !release.officialBase.commit ? '官方构建提交待核验' : <><span>官方构建提交：</span><code>{release.officialBase.commit}</code></>}</p><a href={release.officialBase.sourceUrl} onClick={(event) => { event.preventDefault(); if (release.officialBase) onOpenGithub(release.officialBase.sourceUrl) }}>查看基线依据</a><p className="muted">{release.officialBase.verification === 'declared' ? '依据为该发布源码中的版本声明，尚未证实源码与官方标签完全一致。' : '此记录提供独立核实的官方版本与构建来源。'}</p>{release.officialBase.note && <p className="muted">{release.officialBase.note}</p>}</details></div> : <p className="muted official-base">官方基线待核验</p>}
            <p className="muted release-hash">发布构建提交：<code>{release.sourceCommit ?? '未提供'}</code></p>
            {release.installer ? <div className="release-metadata"><p className="muted">安装包 {release.installer.name} · {(release.installer.size / 1024 / 1024).toFixed(1)} MB</p><p className="muted release-hash">SHA-256：<code>{release.installer.sha256 ?? '发布方未提供，下载后请核验来源'}</code></p></div> : <p className="muted">此发布没有可用的 Windows 安装包。</p>}
            <div className="release-action"><a href={release.htmlUrl} onClick={(event) => { event.preventDefault(); onOpenGithub(release.htmlUrl) }}>查看 GitHub 发布</a>{release.installer && <a className="button download-link" href={release.installer.url} onClick={(event) => { event.preventDefault(); if (release.installer) onOpenGithub(release.installer.url) }}>下载策略整合版安装包</a>}</div>
          </article>
        })}</div> : github && !githubBusy && !githubError ? <div className="card empty-state"><h3>此仓库暂无策略整合版发布</h3><p className="muted">已成功读取仓库，暂时没有可显示的发布。</p></div> : null}
      </section>
      <section className="page-stack" aria-labelledby="extension-releases-heading">
        <div className="page-heading section-heading"><div><h3 id="extension-releases-heading">GitHub 独立策略扩展</h3><p className="muted">公开发布索引：这里只用于发现和查看，不代表已验证兼容，也不能直接授权安装。</p></div></div>
        {extensions.length ? <div className="release-list">{extensions.map((extension: GithubPolicyExtensionRelease) => <article className="card release-row" key={extension.tag}>
          <div className="release-main"><div><h3>{extension.name || `策略扩展 ${extension.version}`}</h3><p className="muted">{extension.package} · 标签 {extension.tag}{extension.prerelease ? ' · 预发布' : ' · 正式发布'}{extension.publishedAt ? ` · ${new Date(extension.publishedAt).toLocaleDateString('zh-CN')}` : ''}</p></div></div>
          {extension.runtimeVersion || extension.runtimeCommit ? <p className="muted">发布页声明的运行时：{extension.runtimeVersion ?? '未知'}{extension.runtimeCommit ? ` · 提交 ${extension.runtimeCommit}` : ''}（未经签名目录验证，不用于兼容判断）</p> : <p className="muted">此 GitHub 发布没有可信的 DSH 运行时映射；兼容性以已验证签名目录为准。</p>}
          <p className="muted release-hash">源码提交声明：<code>{extension.sourceCommit ?? '未提供'}</code>（不等同于桌面运行时构建提交）</p>
          {extension.tarball ? <div className="release-metadata"><p className="muted">扩展包 {extension.tarball.name} · {(extension.tarball.size / 1024 / 1024).toFixed(2)} MB</p><p className="muted release-hash">公开 SHA-256：<code>{extension.tarball.sha256 ?? 'GitHub 未提供摘要'}</code></p></div> : <p className="muted">此发布没有可用的扩展包附件。</p>}
          <div className="release-action"><a href={extension.htmlUrl} onClick={(event) => { event.preventDefault(); onOpenGithub(extension.htmlUrl) }}>查看 GitHub 扩展发布</a>{extension.tarball && <a href={extension.tarball.url} onClick={(event) => { event.preventDefault(); if (extension.tarball) onOpenGithub(extension.tarball.url) }}>查看扩展包附件</a>}</div>
        </article>)}</div> : github && !githubBusy && !githubError ? <div className="card empty-state"><h3>此仓库暂无独立策略扩展发布</h3><p className="muted">未发现可展示的扩展包附件。签名目录中的兼容记录仍单独检查。</p></div> : null}
      </section>
      <section className="page-stack" aria-labelledby="catalog-heading">
        <div className="page-heading section-heading"><div><h3 id="catalog-heading">已验证签名目录</h3><p className="muted">此目录提供经过签名校验的官方 DSH 安装包和策略扩展兼容/安装记录。</p></div><button className="button" onClick={onRefresh} disabled={busy}>刷新版本目录</button></div>
        {releases.length === 0 ? <div className="card empty-state"><span className="empty-icon">◇</span><h3>暂无已验证的安装包</h3><p className="muted">{catalogMessage || '请刷新签名目录。没有官方安装包和校验和的版本不会提供安装。'}</p></div> : <><p className="muted">{catalogMessage}</p><div className="release-list">{releases.map(release => <article className="card release-row" key={release.desktopVersion}>
          <div className="release-main"><div><h3>DSH 桌面版 {release.desktopVersion}{release.desktopVersion === installedVersion && <span className="tag">已安装</span>}</h3><p className="muted">运行时 {release.runtimeVersion} · {release.runtimeCommit?.slice(0, 10) ?? '提交信息不可用'}</p></div><div className="release-policies">{release.policies.length ? release.policies.map(policy => <span className="tag tag--soft" key={`${policy.package}-${policy.version}`}>策略 {policy.version}</span>) : <span className="muted">没有匹配的策略版本</span>}</div></div>
          <div className="release-action"><a href={release.installerUrl} target="_blank" rel="noreferrer">官方安装包来源</a><button className="button button--primary" onClick={() => onInstall(release.desktopVersion)} disabled={busy || state.installationEdition === 'policy' || !release.installable || release.desktopVersion === installedVersion}>安装</button></div>
        </article>)}</div></>}
      </section>
    </section>
  )
}
