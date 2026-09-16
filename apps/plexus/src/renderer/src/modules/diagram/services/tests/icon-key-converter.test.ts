import { test, expect, afterEach } from 'vitest'

import { IconKeyConverter, setIconResourceResolver, DEFAULT_ICON } from '../icon-key-converter.js'

afterEach(() => setIconResourceResolver(undefined))

test('resolves a known key through the active resolver', () => {
    const icon = {} as unknown
    setIconResourceResolver((k) => (k === 'mm_icon_svc' ? icon : undefined))
    expect(new IconKeyConverter().convert('mm_icon_svc')).toBe(icon)
})

test('falls back to the default glyph for an empty key', () => {
    setIconResourceResolver(() => undefined)
    expect(new IconKeyConverter().convert('')).toBe(DEFAULT_ICON)
})

test('falls back to the default glyph for an unresolved key', () => {
    setIconResourceResolver(() => undefined)
    expect(new IconKeyConverter().convert('nope')).toBe(DEFAULT_ICON)
})

test('non-string input is treated as empty and falls back', () => {
    setIconResourceResolver(() => undefined)
    expect(new IconKeyConverter().convert(undefined)).toBe(DEFAULT_ICON)
})

test('the default glyph is a real IconDefinition (has shapes)', () => {
    expect(DEFAULT_ICON.Shapes.length).toBeGreaterThan(0)
})
