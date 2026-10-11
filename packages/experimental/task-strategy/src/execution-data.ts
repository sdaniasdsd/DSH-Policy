/** Synchronous stage prompts and ordered retained-result byte admission. */
import type { TaskResult } from './types.ts'
import { taskPrompt } from './task-prompt.ts'

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
   * @returns the exact model-visible task prompt.
   */
  prompt(instruction: string): string
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
 * @returns stage-local prompt preparation and ordered result retention operations.
 */
export function createStageExecutionData(
  task: string, priorResults: readonly TaskResult[], maxResultBytes: number,
): StageExecutionData {
  const prior = JSON.stringify(priorResults)
  const stageResults: (TaskResult | undefined)[] = []
  const results = (): TaskResult[] => stageResults.filter((entry): entry is TaskResult => entry !== undefined)
  return {
    prompt: instruction => taskPrompt(task, instruction, prior),
    retain: (index, row) => {
      const retained = [...priorResults, ...results(), row]
      if (exceedsResultByteLimit(retained, maxResultBytes)) return false
      stageResults[index] = row
      return true
    },
    results,
  }
}
