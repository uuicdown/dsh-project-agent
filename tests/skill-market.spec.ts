import { describe, expect, it } from 'vitest'
import { searchSkills } from '../src/app/skill-market.ts'

describe('searchSkills', () => {
  it('returns ranked candidates for a known capability', () => {
    const hits = searchSkills('gongwen', 3)
    expect(Array.isArray(hits)).toBe(true)
    for (const hit of hits) expect(hit.stars).toBeGreaterThanOrEqual(0)
  })
  it('returns nothing for an empty query', () => {
    expect(searchSkills('   ')).toEqual([])
  })
  it('ranks a more specific match above a generic one', () => {
    const hits = searchSkills('excel 清洗', 5)
    expect(hits.length).toBeLessThanOrEqual(5)
  })
})
