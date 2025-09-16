import { describe, it, expect } from 'vitest'
import { formatPositionsLabel } from '../scaffolds/fun-launch/src/utils/dbcLabel'

describe('formatPositionsLabel', () => {
  it('returns null while loading', () => {
    expect(formatPositionsLabel(3, true)).toBeNull()
  })
  it('returns null when count is null', () => {
    expect(formatPositionsLabel(null, false)).toBeNull()
  })
  it('formats zero correctly', () => {
    expect(formatPositionsLabel(0, false)).toBe('Positions found: 0')
  })
  it('formats positive numbers', () => {
    expect(formatPositionsLabel(7, false)).toBe('Positions found: 7')
  })
})