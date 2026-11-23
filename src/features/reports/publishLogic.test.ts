import { describe, expect, it } from 'vitest'
import { childrenWithoutReports } from './publishLogic'

const present = [
  { id: 'c1', name: 'ليان' },
  { id: 'c2', name: 'عمر' },
  { id: 'c3', name: 'سارة' },
]

describe('childrenWithoutReports (W2)', () => {
  it('returns present children with no report at all', () => {
    expect(childrenWithoutReports(present, new Set(['c2']))).toEqual([
      { id: 'c1', name: 'ليان' },
      { id: 'c3', name: 'سارة' },
    ])
  })

  it('returns empty when every present child has a report', () => {
    expect(childrenWithoutReports(present, new Set(['c1', 'c2', 'c3']))).toEqual([])
  })

  it('returns empty for an empty present list', () => {
    expect(childrenWithoutReports([], new Set())).toEqual([])
  })

  it('ignores report ids for children not present', () => {
    expect(childrenWithoutReports(present, new Set(['c1', 'c2', 'c3', 'cX']))).toEqual([])
  })
})
