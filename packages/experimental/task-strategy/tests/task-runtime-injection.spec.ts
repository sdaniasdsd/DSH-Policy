import { expect, it } from 'vitest'
import TaskRuns from '../src/task-runtime-service.ts'

it('declares Session access for durable task coordination', () => {
  expect(TaskRuns.inject).toContain('sessions')
})
