/** Synchronous stage prompts and ordered retained-result byte admission. */
import type { PriorResultSelector, TaskResult } from './types.ts'
import { taskPrompt } from './task-prompt.ts'

/**
 * Select model-visible rows without changing cumulative retention or row order.
 * @param results - complete retained history.
 * @param selector - optional binding scope and stable task labels.
 * @param bindingStartResult - first row belonging to the current binding.
 * @returns the selected rows in their original order.
 */
export function selectPriorResults(
  results: readonly TaskResult[], selector?: PriorResultSelector, bindingStartResult = 0,
): readonly TaskResult[] {
  const scoped = selector?.scope === 'current-binding' ? results.slice(bindingStartResult) : results
  const labels = selector?.labels
  return labels === undefined ? scoped : scoped.filter(row => labels.includes(row.label))
}

/**
 * Check the complete retained JSON, including array punctuation and child metadata.
 * @param results - all results proposed for retention, in serialization order.
 * @param maxResultBytes - validated UTF-8 byte limit for the complete array.
 * @returns whether the serialized array exceeds the limit; an exact fit is accepted.
 */
export function exceedsResultByteLimit(results: readonly TaskResult[], maxResultBytes: number): boolean {
  return Buffer.byteLength(JSON.stringify(results), 'utf8') > maxResultBytes
}

interface StageExecutionData {
  /**
   * Render child input using the completed-stage JSON captured at stage start.
   * @param instruction - unchanged child instructions.
   * @param selector - optional prompt-only selection of completed-stage evidence.
   * @returns the exact model-visible task prompt.
   */
  prompt(instruction: string, selector?: PriorResultSelector): string
  /**
   * Retain a row only when the complete candidate result array fits the limit.
   * @param index - original task index within this stage.
   * @param row - settled child result with its stage and task label.
   * @returns whether the row was retained; rejection leaves retained rows unchanged.
   */
  retain(index: number, row: TaskResult): boolean
  /**
   * Read retained rows in original task order, skipping tasks without an admitted row.
   * @returns a new array of this stage's retained rows.
   */
  results(): TaskResult[]
}

/**
 * Capture stage prompt data and collect settled rows synchronously by task index.
 * The caller owns cancellation, failure reporting and publication after child cleanup.
 * @param task - unchanged task body shared with the stage's children.
 * @param priorResults - completed-stage results, unchanged until this stage is published.
 * @param maxResultBytes - validated task-wide UTF-8 result byte limit.
 * @param bindingStartResult - first retained row of the current binding; defaults to the beginning.
 * @returns stage-local prompt preparation and ordered result retention operations.
 */
export function createStageExecutionData(
  task: string, priorResults: readonly TaskResult[], maxResultBytes: number, bindingStartResult = 0,
): StageExecutionData {
  const prior = JSON.stringify(priorResults)
  const stageResults: (TaskResult | undefined)[] = []
  const results = (): TaskResult[] => stageResults.filter((entry): entry is TaskResult => entry !== undefined)
  return {
    prompt: (instruction, selector) => taskPrompt(task, instruction, selector === undefined
      ? prior : JSON.stringify(selectPriorResults(priorResults, selector, bindingStartResult))),
    retain: (index, row) => {
      const retained = [...priorResults, ...results(), row]
      if (exceedsResultByteLimit(retained, maxResultBytes)) return false
      stageResults[index] = row
      return true
    },
    results,
  }
}
