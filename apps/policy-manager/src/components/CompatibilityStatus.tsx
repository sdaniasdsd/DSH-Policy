import type { ManagerSnapshot } from '../manager-types'

function unavailableReasonZh(reason: string | null | undefined) {
  if (!reason) return '已检测到本机 DSH，但当前没有对应的已验证策略安装记录；官方模式仍可使用。'
  if (reason === 'Install an official DSH Desktop release to manage its profile.') return '请安装官方 DSH 桌面版后再管理配置。'
  if (reason === 'The verified release catalog has expired; refresh it before enabling Policy mode.') return '已验证的版本目录已过期，请刷新后再启用策略模式。'
  if (reason === 'The bundled DSH runtime version or commit could not be read.') return '无法读取内置 DSH 运行时版本或提交号。'
  const dirtyBuild = reason.match(/^DSH (.+) is a dirty build and cannot use Policy mode\.$/)
  if (dirtyBuild) return `DSH ${dirtyBuild[1]} 含有未提交的改动，不能使用策略模式。`
  const unmatched = reason.match(/^No exact Policy release matches DSH (.+) at commit .+\.$/)
  if (unmatched) return `已检测到本机 DSH ${unmatched[1]}；当前没有与此运行时关联的已验证策略安装记录，官方模式仍可使用。`
  return reason
}

export function CompatibilityStatus({ state }: { state: ManagerSnapshot }) {
  if (state.installationEdition === 'policy') {
    return <div className="compatibility compatibility--muted">当前为策略独立版，发布关联请查看版本页。</div>
  }
  if (!state.installed) {
    return <div className="compatibility compatibility--muted">未检测到官方 DSH 桌面版。</div>
  }
  if (state.policyCompatible && state.compatiblePolicy) {
    return <div className="compatibility compatibility--good">策略版本 {state.compatiblePolicy.version} 兼容</div>
  }
  return <div className="compatibility compatibility--warn">{unavailableReasonZh(state.unavailableReason)}</div>
}
