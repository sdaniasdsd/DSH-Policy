import { expect, it } from 'vitest'
import * as client from '../src/client/index.ts'

it('declares the browser services required by the Policy style picker', () => {
  expect((client as { inject?: string[] }).inject).toEqual(['slots', 'locale', 'configForms'])
})
