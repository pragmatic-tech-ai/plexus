import { test, expect } from 'vitest'
import { SvgEdits } from '../svg-edits.js'
import { HandleKind } from '../handle-kind.js'

// A minimal element stand-in recording transform get/set (no DOM/layout needed).
class FakeEl
{
    private attrs = new Map<string, string>()
    public parentNode: FakeEl | null = null
    public getAttribute(n: string): string | null { return this.attrs.get(n) ?? null }
    public setAttribute(n: string, v: string): void { this.attrs.set(n, v) }
    public removeAttribute(n: string): void { this.attrs.delete(n) }
    public remove(): void { this.parentNode = null }
}

test('move prepends a translate to the element transform', () => {
    const el = new FakeEl() as unknown as Element
    SvgEdits.move(el, 5, 7)
    expect(el.getAttribute('transform')).toBe('matrix(1,0,0,1,5,7)')
    SvgEdits.move(el, 3, -2)
    expect(el.getAttribute('transform')).toBe('matrix(1,0,0,1,8,5)')
})

test('resize from the SE handle scales about the top-left corner', () => {
    const el = new FakeEl() as unknown as Element
    SvgEdits.resize(el, { x: 0, y: 0, w: 100, h: 50 }, HandleKind.SE, 100, 50)
    expect(el.getAttribute('transform')).toBe('matrix(2,0,0,2,0,0)')
})

test('resize from the E handle scales x only, pivoting on the left edge', () => {
    const el = new FakeEl() as unknown as Element
    SvgEdits.resize(el, { x: 10, y: 0, w: 100, h: 40 }, HandleKind.E, 100, 0)
    expect(el.getAttribute('transform')).toBe('matrix(2,0,0,1,-10,0)')
})

test('remove detaches the element', () => {
    const el = new FakeEl()
    el.parentNode = new FakeEl()
    SvgEdits.remove(el as unknown as Element)
    expect(el.parentNode).toBeNull()
})
