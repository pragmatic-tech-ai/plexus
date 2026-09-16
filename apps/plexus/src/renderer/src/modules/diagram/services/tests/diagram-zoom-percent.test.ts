import { test, expect } from 'vitest'
import { ZoomPercent } from '../diagram-zoom-percent.js'

test('formats a zoom factor as a whole-number percentage', () => {
    expect(ZoomPercent.convert(1)).toBe('100%')
    expect(ZoomPercent.convert(0.5)).toBe('50%')
    expect(ZoomPercent.convert(2.5)).toBe('250%')
    expect(ZoomPercent.convert(0.333)).toBe('33%')
})

test('tolerates a nullish zoom (view not yet mounted)', () => {
    expect(ZoomPercent.convert(undefined)).toBe('')
})
