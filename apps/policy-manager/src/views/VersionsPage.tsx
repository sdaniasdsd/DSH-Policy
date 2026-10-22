import type { DesktopRelease } from '../manager-types'

export function VersionsPage({ releases, installedVersion, onInstall, onRefresh, busy, catalogStatus }: {
  releases: DesktopRelease[]
  installedVersion: string | null
  onInstall: (version: string) => void
  onRefresh: () => void
  busy: boolean
  catalogStatus: string
}) {
  return (
    <section className="page-stack" aria-labelledby="versions-heading">
      <div className="page-heading">
        <div><p className="eyebrow">VERIFIED RELEASES</p><h2 id="versions-heading">DSH versions</h2><p className="muted">Only official installers with a verified hash can be installed.</p></div>
        <button className="button" onClick={onRefresh} disabled={busy}>Refresh catalog</button>
      </div>
      {releases.length === 0 ? (
        <div className="card empty-state"><span className="empty-icon">◇</span><h3>No verified installers are available</h3><p className="muted">{catalogStatus || 'Refresh the signed catalog. Releases without an official installer and checksum remain unavailable.'}</p></div>
      ) : (
        <div className="release-list">
          {releases.map(release => <article className="card release-row" key={release.desktopVersion}>
            <div className="release-main"><div><h3>DSH Desktop {release.desktopVersion}{release.desktopVersion === installedVersion && <span className="tag">Installed</span>}</h3><p className="muted">Runtime {release.runtimeVersion} · {release.runtimeCommit?.slice(0, 10) ?? 'commit unavailable'}</p></div>
              <div className="release-policies">{release.policies.length ? release.policies.map(policy => <span className="tag tag--soft" key={`${policy.package}-${policy.version}`}>Policy {policy.version}</span>) : <span className="muted">No matching Policy release</span>}</div></div>
            <div className="release-action"><a href={release.installerUrl} target="_blank" rel="noreferrer">Official installer source</a><button className="button button--primary" onClick={() => onInstall(release.desktopVersion)} disabled={busy || !release.installable || release.desktopVersion === installedVersion}>Install</button></div>
          </article>)}
        </div>
      )}
    </section>
  )
}
