import { describe, expect, it } from 'vitest'
import { dateKey, entriesForDate, formatVolume, hydrationTotal, type DrinkEntry } from './hydration'

const entries: DrinkEntry[] = [
  {
    id: 'a', drink_type: 'water', volume_ml: 250, hydration_factor: 1,
    hydration_estimate_ml: 250, notes: null, consumed_at: '2026-10-20T06:30:00.000Z',
  },
  {
    id: 'b', drink_type: 'coffee', volume_ml: 200, hydration_factor: 0.9,
    hydration_estimate_ml: 180, notes: null, consumed_at: '2026-10-20T18:30:00.000Z',
  },
]

describe('hydration helpers', () => {
  it('converts measured volume to millilitres and US fluid ounces', () => {
    expect(formatVolume(500, 'ml')).toBe('500 ml')
    expect(formatVolume(500, 'oz')).toBe('16.9 oz')
  })

  it('totals hydration estimates rather than consumed volume', () => {
    expect(hydrationTotal(entries)).toBe(430)
  })

  it('groups entries by the user-selected local calendar date', () => {
    expect(dateKey(new Date('2026-10-20T06:30:00.000Z'), 'America/Los_Angeles')).toBe('2026-10-19')
    expect(entriesForDate(entries, '2026-10-19', 'America/Los_Angeles')).toHaveLength(1)
    expect(entriesForDate(entries, '2026-10-20', 'America/Los_Angeles')).toHaveLength(1)
  })
})
