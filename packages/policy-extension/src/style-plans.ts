import type { ExecutionPlan } from './task-runtime/types.ts'
import type { PolicyStyleId } from './policy-config-types.ts'
export type { PolicyStyleId } from './policy-config-types.ts'

/** Display names for the styles restored to the Policy composer. */
export const POLICY_STYLES: readonly { readonly id: PolicyStyleId; readonly label: string }[] = [
  { id: 'codex-style', label: 'Codex style' },
  { id: 'claude-style', label: 'Claude style' },
  { id: 'zcode-style', label: 'ZCode style' },
  { id: 'superpowers-style', label: 'Superpowers style' },
]

const recipes: Record<PolicyStyleId, { name: string; stages: { name: string; instruction: string }[] }> = {
  'codex-style': {
    name: 'Codex style',
    stages: [
      { name: 'inspect', instruction: 'Inspect the relevant workspace and identify the smallest safe implementation. Do not edit yet.' },
      { name: 'implement', instruction: 'Implement the requested task using the inspection findings. Verify the changed behavior.' },
      { name: 'review', instruction: 'Review the implementation and verification evidence. Fix only confirmed issues and report remaining limits.' },
    ],
  },
  'claude-style': {
    name: 'Claude style',
    stages: [
      { name: 'explore', instruction: 'Explore the relevant workspace, trace affected behavior, and report evidence and risks. Do not edit.' },
      { name: 'implement', instruction: 'Implement the requested task, using the exploration findings. Verify the result.' },
      { name: 'review', instruction: 'Review the result against the task and the exploration findings. Correct confirmed defects and report remaining limits.' },
    ],
  },
  'zcode-style': {
    name: 'ZCode style',
    stages: [
      { name: 'breakdown', instruction: 'Break the task into ordered milestones, identify dependencies, and inspect the affected workspace. Do not edit.' },
      { name: 'milestones', instruction: 'Complete the next implementation milestone and verify it before moving on.' },
      { name: 'integration', instruction: 'Check the integrated result across affected files and report completed milestones, evidence, and remaining work.' },
    ],
  },
  'superpowers-style': {
    name: 'Superpowers style',
    stages: [
      { name: 'understand', instruction: 'Clarify the task from the available context, inspect relevant code, and state constraints and acceptance conditions. Do not edit.' },
      { name: 'plan', instruction: 'Produce a concise implementation sequence from the evidence and acceptance conditions. Do not edit.' },
      { name: 'implement', instruction: 'Implement the approved task following the sequence. Keep changes focused.' },
      { name: 'verify', instruction: 'Run the relevant verification and inspect the resulting changes. Fix failures caused by the implementation.' },
      { name: 'review', instruction: 'Review for missed requirements, regressions, and incomplete work; report evidence and remaining limits.' },
    ],
  },
}

/** Build a detached staged plan for one selected style and task. */
export function createStylePlan(style: PolicyStyleId, task: string): ExecutionPlan {
  const recipe = recipes[style]
  return {
    name: style,
    stages: recipe.stages.map(({ name, instruction }) => ({
      name,
      serial: true,
      tasks: [{ label: name, preset: 'standard', instruction: `${instruction}\n\nUser task:\n${task}` }],
    })),
  }
}
