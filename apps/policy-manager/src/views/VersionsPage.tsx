import type { DesktopRelease } from '../manager-types'

export function VersionsPage({ releases, installedVersion, onInstall, onRefresh, busy, catalogStatus }: {
  releases: DesktopRelease[]
  installedVersion: string | null
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
  return (
    <section className="page-stack" aria-labelledby="versions-heading">
      <div className="page-heading">
        <div><p className="eyebrow">已验证版本</p><h2 id="versions-heading">DSH 版本</h2><p className="muted">只能安装来自官方且哈希已验证的安装包。</p></div>
        <button className="button" onClick={onRefresh} disabled={busy}>刷新版本目录</button>
      </div>
      {releases.length === 0 ? (
        <div className="card empty-state"><span className="empty-icon">◇</span><h3>暂无已验证的安装包</h3><p className="muted">{catalogMessage || '请刷新签名目录。没有官方安装包和校验和的版本不会提供安装。'}</p></div>
      ) : (
        <div className="release-list">
          {releases.map(release => <article className="card release-row" key={release.desktopVersion}>
            <div className="release-main"><div><h3>DSH 桌面版 {release.desktopVersion}{release.desktopVersion === installedVersion && <span className="tag">已安装</span>}</h3><p className="muted">运行时 {release.runtimeVersion} · {release.runtimeCommit?.slice(0, 10) ?? '提交信息不可用'}</p></div>
              <div className="release-policies">{release.policies.length ? release.policies.map(policy => <span className="tag tag--soft" key={`${policy.package}-${policy.version}`}>策略 {policy.version}</span>) : <span className="muted">没有匹配的策略版本</span>}</div></div>
            <div className="release-action"><a href={release.installerUrl} target="_blank" rel="noreferrer">官方安装包来源</a><button className="button button--primary" onClick={() => onInstall(release.desktopVersion)} disabled={busy || !release.installable || release.desktopVersion === installedVersion}>安装</button></div>
          </article>)}
        </div>
      )}
    </section>
  )
}
