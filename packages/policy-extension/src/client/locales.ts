/** Browser-owned wording for the Policy composer style selector. */
export type PolicyLocaleKey = 'style' | 'codexStyle' | 'claudeStyle' | 'zcodeStyle' | 'superpowersStyle' | 'saveFailed'

/** Simplified Chinese labels shown in DSH. */
export const zh: Record<PolicyLocaleKey, string> = {
  style: '策略风格', codexStyle: 'Codex 风格', claudeStyle: 'Claude 风格',
  zcodeStyle: 'ZCode 风格', superpowersStyle: 'Superpowers 风格', saveFailed: '策略风格保存失败',
}

/** English labels shown in DSH. */
export const en: Record<PolicyLocaleKey, string> = {
  style: 'Policy style', codexStyle: 'Codex style', claudeStyle: 'Claude style',
  zcodeStyle: 'ZCode style', superpowersStyle: 'Superpowers style', saveFailed: 'Failed to save policy style',
}
