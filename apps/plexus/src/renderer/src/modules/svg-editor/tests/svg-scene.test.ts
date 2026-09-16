// @vitest-environment jsdom
import { test, expect } from 'vitest'
import { SvgScene } from '../svg-scene.js'

const RECT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
    + '<rect x="1" y="2" width="3" height="4" fill="red"/></svg>'

test('parse returns the root SVG element for well-formed markup', () => {
    const r = SvgScene.parse(RECT)
    expect('svg' in r).toBe(true)
    if ('svg' in r) expect(r.svg.tagName.toLowerCase()).toBe('svg')
})

test('parse reports an error for malformed markup', () => {
    const r = SvgScene.parse('<svg><rect></svg>')   // unclosed rect
    expect('error' in r).toBe(true)
})

test('serialize round-trips an untouched element', () => {
    const r = SvgScene.parse(RECT)
    if (!('svg' in r)) throw new Error('expected parse to succeed')
    const out = SvgScene.serialize(r.svg)
    // The rect and its attributes survive verbatim.
    expect(out).toContain('<rect')
    expect(out).toContain('width="3"')
    expect(out).toContain('fill="red"')
    // Re-parsing the serialized form still succeeds.
    expect('svg' in SvgScene.parse(out)).toBe(true)
})
