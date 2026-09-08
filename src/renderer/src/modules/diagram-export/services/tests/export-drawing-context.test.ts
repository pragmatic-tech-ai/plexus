import { test, expect } from 'vitest'
import { FormattedText, Point } from '@pragmatic-tech-ai/mural/visual-engine'
import { ExportDrawingContext } from '../export-drawing-context.js'

// FormattedText ctor: (text, fontFamily, fontSize, foreground, ...). A TextBlock whose
// FontFamily was never set produces `new FontFamily(undefined)`, so RenderOverride
// passes FontFamily.Source === undefined here. mural's SvgDrawingContext.DrawText would
// then call escapeXmlAttr(undefined) → `Cannot read properties of undefined (reading
// 'replace')`, aborting the export. ExportDrawingContext must default it instead.

test('DrawText with an undefined FontFamily does not throw and emits mural\'s default font', () => {
  const dc = new ExportDrawingContext()
  const text = new FormattedText('hello', undefined as unknown as string, 12, undefined)

  expect(() => dc.DrawText(text, Point.Zero)).not.toThrow()

  const svg = dc.ToFragment()
  expect(svg).toContain('font-family="system-ui, sans-serif"')
  expect(svg).toContain('>hello<')
})

test('DrawText leaves an explicit FontFamily untouched', () => {
  const dc = new ExportDrawingContext()
  const text = new FormattedText('hi', 'Comic Sans MS', 14, undefined)

  dc.DrawText(text, Point.Zero)

  const svg = dc.ToFragment()
  expect(svg).toContain('font-family="Comic Sans MS"')
  expect(svg).not.toContain('system-ui')
})
