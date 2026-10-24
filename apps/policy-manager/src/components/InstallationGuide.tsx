import type { GithubReleaseIndex, ManagerSnapshot } from '../manager-types'
import { recommendInstallation } from '../install-recommendation'

export function InstallationGuide({
  state,
  github,
  githubBusy,
  githubError,
  busy,
  detectionFailed,
  onOpenGithub,
  onEnablePolicy,
  onSelectInstallation,
  onViewVersions,
  onViewInstallations,
}: {
  state: ManagerSnapshot
  github: GithubReleaseIndex | null
  githubBusy: boolean
  githubError: string | null
  busy: boolean
  detectionFailed: boolean
  onOpenGithub: (url: string) => void
  onEnablePolicy: () => void
  onSelectInstallation: (path: string) => void
  onViewVersions?: () => void
  onViewInstallations?: () => void
}) {
  const recommendation = recommendInstallation(state, github)
  const release = recommendation.integratedRelease
  const existingPolicy = recommendation.existingPolicy
  const matchingPolicyAlreadyInstalled = Boolean(state.compatiblePolicy && state.policyVersion === state.compatiblePolicy.version)
  const currentSummary = recommendation.current === 'not-installed' ? '还没有检测到 DSH。'
    : recommendation.current === 'choose-installation' ? '检测到本机安装，但尚未选定有效的管理目标。请先在概览中选择。'
      : `当前管理：${recommendation.current === 'official' ? '官方版' : '策略整合版'} ${state.installed?.desktopVersion}`
  const alreadyEnabled = recommendation.canEnablePolicy && state.mode === 'policy' && state.policyVersion === state.compatiblePolicy?.version
  const extensionStatus = state.knownPolicy && state.installed
    ? state.installed.runtimeVersion === state.knownPolicy.dshVersion
      ? '要求的官方 DSH 运行时版本与本机相同；桌面构建提交不与上游标签提交直接比较。自动安装仍需已验证目录收录。'
      : `独立增强包 ${state.knownPolicy.policyVersion} 要求官方 DSH ${state.knownPolicy.dshVersion}，本机运行时为 ${state.installed.runtimeVersion ?? '未知'}。`
    : '当前没有已验证的直装记录。'
  const integratedMessage = existingPolicy ? `本机已有策略整合版 ${existingPolicy.installed.desktopVersion}，无需重复下载。`
    : recommendation.integratedAction === 'current' ? '当前已是已读取的最高正式版本，无需重新安装。'
      : recommendation.integratedAction === 'keep-newer' ? '当前整合版高于已读取的正式版本，建议保留当前版本。'
        : recommendation.integratedAction === 'keep-preview' ? '当前使用预发布版，建议保留当前安装，先查看发布说明。'
          : recommendation.integratedAction === 'unknown-current' ? '当前整合版版本无法比较，请先核对发布说明，保留当前安装。'
            : release ? `可选已读取的正式版本：策略整合版 ${release.version}`
              : githubBusy && !github ? '正在读取正式发布信息，当前安装仍可保留。'
                : '暂无可推荐的正式整合包，请查看版本列表或保留当前安装。'
  const canDownload = recommendation.integratedAction === 'download' && recommendation.current !== 'choose-installation'
  return (
    <section className="card installation-guide" aria-labelledby="installation-guide-heading">
      <div className="guide-heading"><div><p className="eyebrow">从这里开始</p><h2 id="installation-guide-heading">我该装哪个</h2></div><span className="tag tag--soft">按本机情况选择</span></div>
      <p className="guide-current">{currentSummary}</p>
      {githubError && <p className="guide-caution">{github ? '发布检查失败，以下仅为上次成功读取的正式版本；不能确认是否最新。' : '发布检查失败，暂时无法核对公开版本；本机已有安装仍可选择。'}</p>}
      {detectionFailed && <p className="guide-caution">本机检测失败，请重新检测后再启用增强包。</p>}
      <div className="guide-options">
        <div className={`guide-option${recommendation.canEnablePolicy ? ' guide-option--recommended' : ''}`}>
          <h3>{recommendation.current === 'official' ? '保留当前官方版' : '关于独立增强包'}</h3>
          {recommendation.canEnablePolicy && <p className="guide-advice">匹配方案：官方 DSH {state.installed?.runtimeVersion} + 独立增强包 {state.compatiblePolicy?.version}</p>}
          {!recommendation.canEnablePolicy && <p className="muted">{extensionStatus}</p>}
          {recommendation.canEnablePolicy ? <><p className="muted">{alreadyEnabled ? '匹配的增强包已启用，继续使用当前安装即可。' : matchingPolicyAlreadyInstalled ? '匹配的扩展包已安装。切换模式前会备份共享数据。' : '签名目录已验证精确匹配的增强包。首次启用会备份共享数据，校验下载包后安装并切换模式。'}</p><button className="button button--primary" disabled={busy || detectionFailed || alreadyEnabled} onClick={onEnablePolicy}>{alreadyEnabled ? '匹配的增强包已启用' : matchingPolicyAlreadyInstalled ? '启用匹配的增强包' : '安装并启用匹配的增强包'}</button></> : <>
            <p className="muted">当前没有已验证的直装记录。官方版可继续使用；管理器不会仅凭提交号不同就判定运行时不兼容。</p>
            {state.installationEdition === 'policy' && <p className="muted">当前安装已包含策略功能，无需另装增强包。</p>}
          </>}
        </div>
        <div className={`guide-option${!recommendation.canEnablePolicy ? ' guide-option--recommended' : ''}`}>
          <h3>直接使用策略整合版</h3><p className="muted">这是完整应用，无需先安装官方版或另装增强包。</p><p className="guide-advice">{integratedMessage}</p>
          {existingPolicy && <><button className="button button--primary" disabled={busy || detectionFailed || Boolean(state.homeChoice)} onClick={() => onSelectInstallation(existingPolicy.installed.installLocation)}>使用已安装的策略整合版 {existingPolicy.installed.desktopVersion}</button><p className="muted">只切换管理目标，不会自动启动应用或启用增强包。</p></>}
          {canDownload && release?.installer && <button className="button button--primary" disabled={busy} onClick={() => { if (release.installer) onOpenGithub(release.installer.url) }}>下载推荐整合版 {release.version}</button>}
          {!canDownload && release && <button className="button" disabled={busy} onClick={() => onOpenGithub(release.htmlUrl)}>查看正式发布说明</button>}
          {recommendation.current === 'choose-installation' && onViewInstallations && <button className="button" onClick={onViewInstallations}>查看本机安装</button>}
          <p className="muted guide-footnote">下载后需手动运行安装包。推荐仅使用有基线依据的正式发布，不会自动升级或降级。</p>
        </div>
      </div>
      {onViewVersions && <button className="button guide-more" onClick={onViewVersions}>查看全部版本与依据</button>}
    </section>
  )
}
