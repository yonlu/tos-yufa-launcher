import { describe, expect, it } from 'vitest'
import { formatNewsDate } from '../src/renderer/src/lib/format'

describe('formatNewsDate', () => {
  it('writes the date as the site does, day first and the month abbreviated', () => {
    expect(formatNewsDate('2026-07-01', 'en')).toBe('01 jul 2026')
    expect(formatNewsDate('2026-12-25', 'en')).toBe('25 dec 2026')
  })

  it('drops the period pt-BR puts after the month', () => {
    expect(formatNewsDate('2026-07-01', 'pt-BR')).toBe('01 jul 2026')
    expect(formatNewsDate('2026-03-15', 'pt-BR')).toBe('15 mar 2026')
  })

  it('shows anything that is not a date as it came', () => {
    expect(formatNewsDate('soon', 'pt-BR')).toBe('soon')
    expect(formatNewsDate('2026-7-1', 'en')).toBe('2026-7-1')
  })
})
