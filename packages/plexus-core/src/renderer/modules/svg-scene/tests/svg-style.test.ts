import { test, expect } from 'vitest'
import { SvgStyle } from '../svg-style.js'

class FakeEl
{
    private a = new Map<string, string>()
    getAttribute(n: string): string | null { return this.a.get(n) ?? null }
    setAttribute(n: string, v: string): void { this.a.set(n, v) }
    removeAttribute(n: string): void { this.a.delete(n) }
}

test('parseColorToHex normalises hex, rgb, and none', () => {
    expect(SvgStyle.ParseColorToHex('#ff0000')).toBe('#ff0000')
    expect(SvgStyle.ParseColorToHex('#f00')).toBe('#ff0000')
    expect(SvgStyle.ParseColorToHex('rgb(255, 99, 71)')).toBe('#ff6347')
    expect(SvgStyle.ParseColorToHex('rgba(0, 128, 0, 1)')).toBe('#008000')
    expect(SvgStyle.ParseColorToHex('none')).toBeUndefined()
    expect(SvgStyle.ParseColorToHex('')).toBeUndefined()
})

test('applyFill / applyStroke write the attribute', () => {
    const el = new FakeEl() as unknown as Element
    SvgStyle.ApplyFill(el, '#00ff00')
    expect(el.getAttribute('fill')).toBe('#00ff00')
    SvgStyle.ApplyStroke(el, '#123456')
    expect(el.getAttribute('stroke')).toBe('#123456')
})

test('applyStrokeWidth / applyOpacity write numeric attributes; opacity clamps 0..1', () => {
    const el = new FakeEl() as unknown as Element
    SvgStyle.ApplyStrokeWidth(el, 2.5)
    expect(el.getAttribute('stroke-width')).toBe('2.5')
    SvgStyle.ApplyOpacity(el, 0.4)
    expect(el.getAttribute('opacity')).toBe('0.4')
    SvgStyle.ApplyOpacity(el, 5)
    expect(el.getAttribute('opacity')).toBe('1')
})

test('brush round-trips through hex (Format Shape Fill value)', () => {
    expect(SvgStyle.HexFromBrush(SvgStyle.BrushFromHex('#ff6347'))).toBe('#ff6347')
    expect(SvgStyle.HexFromBrush(undefined)).toBeUndefined()
})

test('pen carries the stroke colour and thickness (Format Shape Stroke value)', () => {
    const pen = SvgStyle.PenFromHex('#0000ff', 3)
    expect(pen.Thickness).toBe(3)
    expect(SvgStyle.HexFromBrush(pen.Brush)).toBe('#0000ff')
})
