// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('policy manager shell', () => {
  it('shows the manager identity on the home screen', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'DSH Policy Manager' })).toBeTruthy()
  })
})
