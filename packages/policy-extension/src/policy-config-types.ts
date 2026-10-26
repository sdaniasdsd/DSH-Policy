/** A user-selectable DSH orchestration style. */
export type PolicyStyleId = 'codex-style' | 'claude-style' | 'zcode-style' | 'superpowers-style'

/** Host settings selected by the browser Policy control. */
export interface PolicyExtensionConfig {
  /** Style used by newly accepted policy jobs. */
  readonly style: PolicyStyleId
}
