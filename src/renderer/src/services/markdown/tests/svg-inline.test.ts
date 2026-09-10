import { test, expect } from 'vitest'
import { Image, InlineUIContainer } from '@pragmatic-tech-ai/mural/basic'
import { BitmapImage } from '@pragmatic-tech-ai/mural/visual-engine'
import { SvgInline } from '../svg-inline.js'

function sizeOf(svg: string): { w: number; h: number } {
    const img = (SvgInline.toImage(svg) as InlineUIContainer).Child as Image
    const src = img.Source as BitmapImage
    return { w: src.NaturalSize.Width, h: src.NaturalSize.Height }
}

test('honours author-set width/height (the custom attributes)', () => {
    expect(sizeOf('<svg width="512" height="512" viewBox="0 0 256 256"></svg>')).toEqual({ w: 512, h: 512 })
    expect(sizeOf('<svg width="128px" height="64px"></svg>')).toEqual({ w: 128, h: 64 })
})

test('falls back to the viewBox size when width/height are absent', () => {
    expect(sizeOf('<svg viewBox="0 0 100 50"></svg>')).toEqual({ w: 100, h: 50 })
})

test('derives the missing dimension from the viewBox aspect', () => {
    // width only → height = width * (vbH / vbW)
    expect(sizeOf('<svg width="200" viewBox="0 0 100 50"></svg>')).toEqual({ w: 200, h: 100 })
})

test('a percentage width is not treated as pixels (falls back to viewBox)', () => {
    expect(sizeOf('<svg width="100%" viewBox="0 0 40 20"></svg>')).toEqual({ w: 40, h: 20 })
})

test('defaults to a square when neither width/height nor viewBox is present', () => {
    expect(sizeOf('<svg></svg>')).toEqual({ w: 256, h: 256 })
})

test('clamps an oversized SVG to the reading-column width, preserving aspect', () => {
    expect(sizeOf('<svg width="2000" height="1000"></svg>')).toEqual({ w: 680, h: 340 })
})

test('encodes the SVG as a data:image/svg+xml URI', () => {
    const img = (SvgInline.toImage('<svg width="10" height="10"><rect/></svg>') as InlineUIContainer).Child as Image
    expect((img.Source as BitmapImage).Uri.startsWith('data:image/svg+xml')).toBe(true)
})

test('looksLikeSvg / extract recognise a real element and ignore non-SVG', () => {
    expect(SvgInline.looksLikeSvg('  <svg width="1"></svg>')).toBe(true)
    expect(SvgInline.looksLikeSvg('not svg')).toBe(false)
    expect(SvgInline.extract('lead\n<svg viewBox="0 0 1 1"><path/></svg>\ntrail')).toBe('<svg viewBox="0 0 1 1"><path/></svg>')
    expect(SvgInline.extract('no svg here')).toBeUndefined()
})
