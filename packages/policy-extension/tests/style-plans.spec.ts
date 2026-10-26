import { describe, expect, it } from 'vitest'
import { createStylePlan, POLICY_STYLES } from '../src/style-plans.ts'

describe('policy style plans', () => {
  it('offers the four strategy styles from the previous Policy interface', () => {
    expect(POLICY_STYLES.map(({ id }) => id)).toEqual([
      'codex-style', 'claude-style', 'zcode-style', 'superpowers-style',
    ])
  })

  it.each(POLICY_STYLES.map(({ id }) => id))('%s captures a non-empty staged plan', (style) => {
    const plan = createStylePlan(style, 'Build a small web game')
    expect(plan.name).toBe(style)
    expect(plan.stages.length).toBeGreaterThan(1)
    expect(plan.stages.every(stage => stage.tasks.length > 0)).toBe(true)
    expect(plan.stages.flatMap(stage => stage.tasks).every(task => task.instruction.includes('Build a small web game'))).toBe(true)
  })
})
