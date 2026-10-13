import { test, expect } from 'vitest'
import { SvgMatrix } from '../svg-matrix.js'

test('identity is the neutral element and formats as matrix(1,0,0,1,0,0)', () => {
    expect(SvgMatrix.Identity().toString()).toBe('matrix(1,0,0,1,0,0)')
})

test('translate composes into e/f', () => {
    const m = SvgMatrix.Translate(5, -3)
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([1, 0, 0, 1, 5, -3])
})

test('translate ∘ translate adds offsets', () => {
    const m = SvgMatrix.Translate(5, 5).Multiply(SvgMatrix.Translate(2, 3))
    expect([m.e, m.f]).toEqual([7, 8])
})

test('scaleAbout keeps the pivot fixed', () => {
    const m = SvgMatrix.ScaleAbout(2, 2, 10, 10)
    expect(m.Apply(10, 10)).toEqual({ x: 10, y: 10 })
    expect(m.Apply(20, 20)).toEqual({ x: 30, y: 30 })
})

test('parse reads translate(...) and scale(...) and matrix(...)', () => {
    expect(SvgMatrix.Parse('translate(4,6)').Apply(0, 0)).toEqual({ x: 4, y: 6 })
    expect(SvgMatrix.Parse('scale(2)').Apply(3, 4)).toEqual({ x: 6, y: 8 })
    expect(SvgMatrix.Parse('matrix(1,0,0,1,7,8)').Apply(0, 0)).toEqual({ x: 7, y: 8 })
})

test('parse falls back to identity for unsupported/empty transforms', () => {
    expect(SvgMatrix.Parse('').Apply(2, 2)).toEqual({ x: 2, y: 2 })
    expect(SvgMatrix.Parse('rotate(45)').Apply(2, 2)).toEqual({ x: 2, y: 2 })
})
