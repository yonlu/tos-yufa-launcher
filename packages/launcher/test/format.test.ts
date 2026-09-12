import { describe, expect, it } from 'vitest'
import { formatNewsDate } from '../src/renderer/src/lib/format'

describe('formatNewsDate', () => {
  it('writes the date as the site does, day first and the month abbreviated', () => {
    expect(formatNewsDate(Date.UTC(2026, 6, 1), 'en')).toBe('01 jul 2026')
    expect(formatNewsDate(Date.UTC(2026, 11, 25), 'en')).toBe('25 dec 2026')
  })

  it('drops the period pt-BR puts after the month', () => {
    expect(formatNewsDate(Date.UTC(2026, 6, 1), 'pt-BR')).toBe('01 jul 2026')
    expect(formatNewsDate(Date.UTC(2026, 2, 15), 'pt-BR')).toBe('15 mar 2026')
  })

  it('takes the day in UTC, as the site prints it', () => {
    expect(formatNewsDate(Date.UTC(2026, 6, 1, 23, 30), 'en')).toBe('01 jul 2026')
    expect(formatNewsDate(Date.UTC(2026, 6, 1, 0, 30), 'en')).toBe('01 jul 2026')
  })

  it('shows nothing for a number that is not a moment', () => {
    expect(formatNewsDate(Number.NaN, 'pt-BR')).toBe('')
  })
})
