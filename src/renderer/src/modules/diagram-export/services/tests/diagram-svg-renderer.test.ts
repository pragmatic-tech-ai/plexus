import { test, expect } from 'vitest'
import { Visibility } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramSvgRenderer } from '../diagram-svg-renderer.js'
import { ExportFormat, ExportBackground, type ExportOptions } from '../export-options.js'

// Minimal duck-typed Visual: the renderer only reads these public members, never
// anything that reparents (no SetTarget/set Content) — the regression this guards
// is passing a live, already-attached visual to a HeadlessTarget, which threw
// "Visual is already attached to a host".
function fakeVisual(
  rect: { X: number; Y: number; Width?: number; Height?: number },
  children: unknown[] = [],
  opts: { visible?: boolean; render?: () => void } = {},
): unknown {
  return {
    Visibility: opts.visible === false ? Visibility.Collapsed : Visibility.Visible,
    ArrangedRect: { X: rect.X, Y: rect.Y, Width: rect.Width ?? 0, Height: rect.Height ?? 0 },
    Clip: undefined,
    ChildClip: undefined,
    visualChildren: children,
    Render: opts.render ?? ((): void => {}),
  }
}

// Rect field names verified against:
//   node_modules/@pragmatic-tech-ai/mural/dist/visual-engine/primitives.d.ts
// Constructor signature: new Rect(X, Y, Width, Height)
// Properties: .X, .Y, .Width, .Height (also exposes .Left/.Top/.Right/.Bottom as aliases)

test('contentBounds unions the panel\'s ARRANGED children (canvas geometry)', () => {
  const panel = fakeVisual({ X: 0, Y: 0 }, [
    fakeVisual({ X: 10, Y: 10, Width: 20, Height: 20 }), // → (10,10)-(30,30)
    fakeVisual({ X: 40, Y: 5,  Width: 10, Height: 50 }), // → (40,5)-(50,55)
  ])
  const r = DiagramSvgRenderer.contentBounds(panel as never)
  expect(r.X).toBe(10);     expect(r.Y).toBe(5)
  expect(r.Width).toBe(40); expect(r.Height).toBe(50) // 50-10, 55-5
})

test('contentBounds skips zero-area children and is a zero rect when empty', () => {
  const panel = fakeVisual({ X: 0, Y: 0 }, [fakeVisual({ X: 3, Y: 3, Width: 0, Height: 0 })])
  const r = DiagramSvgRenderer.contentBounds(panel as never)
  expect(r.Width).toBe(0); expect(r.Height).toBe(0)

  const none = DiagramSvgRenderer.contentBounds(undefined)
  expect(none.Width).toBe(0); expect(none.Height).toBe(0)
})

test('paintVisualTree walks children in place: translate around offset visuals, render each', () => {
  const calls: string[] = []
  const dc = {
    PushTransform: (): number => calls.push('pushT'),
    PushClip:      (): number => calls.push('pushC'),
    Pop:           (): number => calls.push('pop'),
  }
  const leaf = fakeVisual({ X: 10, Y: 10 }, [], { render: () => { calls.push('render:leaf') } })
  const root = fakeVisual({ X: 0, Y: 0 }, [leaf], { render: () => { calls.push('render:root') } })

  DiagramSvgRenderer.paintVisualTree(root as never, dc as never)

  // root at (0,0) → no translate; leaf at (10,10) → translate push/pop around it.
  expect(calls).toEqual(['render:root', 'pushT', 'render:leaf', 'pop'])
})

test('paintVisualTree skips collapsed visuals (and their subtree)', () => {
  const calls: string[] = []
  const dc = { PushTransform: (): void => {}, PushClip: (): void => {}, Pop: (): void => {} }
  const hiddenChild = fakeVisual({ X: 1, Y: 1 }, [], { render: () => { calls.push('render:hiddenChild') } })
  const hidden = fakeVisual({ X: 0, Y: 0 }, [hiddenChild], { visible: false, render: () => { calls.push('render:hidden') } })

  DiagramSvgRenderer.paintVisualTree(hidden as never, dc as never)

  expect(calls).toEqual([]) // nothing painted — the collapsed root short-circuits
})

test('renderDocument sizes the SVG from arranged children, NOT geometry-less doc.Nodes', () => {
  // A panel whose realized child figure carries the real 120×90 geometry. The
  // document's content VMs (doc.Nodes) carry NO geometry, so the renderer must not
  // consult them — reading bounds off them would yield a 1×1 (blank) SVG, the
  // reported "renders nothing" bug.
  const panel = fakeVisual({ X: 0, Y: 0 }, [fakeVisual({ X: 0, Y: 0, Width: 120, Height: 90 })])
  const diagram = { SelectionCount: 0, ItemsPanelInstance: panel }
  const doc = { ActiveView: diagram }

  const { svg, width, height } = DiagramSvgRenderer.renderDocument(doc as never)

  expect(svg.startsWith('<svg')).toBe(true)
  expect(width).toBe(120)
  expect(height).toBe(90)
})

test('renderDocument uses selection bounds when items are selected', () => {
  const panel = fakeVisual({ X: 0, Y: 0 }, [fakeVisual({ X: 0, Y: 0, Width: 999, Height: 999 })])
  const diagram = {
    SelectionCount: 2,
    SelectionLeft: 5, SelectionTop: 5, SelectionWidth: 40, SelectionHeight: 30,
    ItemsPanelInstance: panel,
  }
  const doc = { ActiveView: diagram }

  const { width, height } = DiagramSvgRenderer.renderDocument(doc as never)

  expect(width).toBe(40) // selection wins over the full-content union
  expect(height).toBe(30)
})

function opts(over: Partial<ExportOptions> = {}): ExportOptions {
  return {
    format: ExportFormat.Svg, useSelection: false,
    background: ExportBackground.Transparent, showPageBreaks: false, scale: 2, ...over,
  }
}

// A fake PaginatedCanvas: the render-time overrides set these plain props, and the
// Render spy captures PageBorderThickness AT PAINT TIME so we can prove it was
// forced to 0 during the walk and restored afterward.
function fakePaginated(children: unknown[], captured: { thickness?: number }): any {
  const panel: any = {
    PageBorderThickness: 1, PaperBrush: 'ORIGINAL_PAPER', Fill: 'ORIGINAL_FILL',
    Visibility: Visibility.Visible,
    ArrangedRect: { X: 0, Y: 0, Width: 0, Height: 0 },
    Clip: undefined, ChildClip: undefined, visualChildren: children,
    Render: (): void => { captured.thickness = panel.PageBorderThickness },
  }
  return panel
}

test('renderWithOptions: page breaks OFF forces PageBorderThickness=0 during paint, restores after', () => {
  const captured: { thickness?: number } = {}
  const panel = fakePaginated([fakeVisual({ X: 0, Y: 0, Width: 100, Height: 60 })], captured)
  const doc = { ActiveView: { SelectionCount: 0, ItemsPanelInstance: panel } }

  DiagramSvgRenderer.renderWithOptions(doc as never, opts({ showPageBreaks: false }))

  expect(captured.thickness).toBe(0)           // forced off while painting
  expect(panel.PageBorderThickness).toBe(1)    // restored
  expect(panel.PaperBrush).toBe('ORIGINAL_PAPER')
  expect(panel.Fill).toBe('ORIGINAL_FILL')
})

test('renderWithOptions: Surface background paints a bg rect of the chosen color', () => {
  const captured: { thickness?: number } = {}
  const panel = fakePaginated([fakeVisual({ X: 0, Y: 0, Width: 100, Height: 60 })], captured)
  const doc = { ActiveView: { SelectionCount: 0, ItemsPanelInstance: panel } }

  const { svg } = DiagramSvgRenderer.renderWithOptions(
    doc as never, opts({ background: ExportBackground.Surface, backgroundColor: '#123456' }))

  expect(svg).toContain('rgb(18,52,86)') // #123456 → SvgDrawingContext emits rgb via Color.ToCss()
})

test('renderWithOptions: Transparent background paints no bg rect', () => {
  const captured: { thickness?: number } = {}
  const panel = fakePaginated([fakeVisual({ X: 0, Y: 0, Width: 100, Height: 60 })], captured)
  const doc = { ActiveView: { SelectionCount: 0, ItemsPanelInstance: panel } }

  const { svg } = DiagramSvgRenderer.renderWithOptions(doc as never, opts({ background: ExportBackground.Transparent }))

  expect(svg).not.toContain('rgb(18,52,86)')
})

test('renderWithOptions: useSelection=false uses whole content bounds even when a selection exists', () => {
  const captured: { thickness?: number } = {}
  const panel = fakePaginated([fakeVisual({ X: 0, Y: 0, Width: 200, Height: 150 })], captured)
  const doc = { ActiveView: {
    SelectionCount: 2, SelectionLeft: 5, SelectionTop: 5, SelectionWidth: 40, SelectionHeight: 30,
    ItemsPanelInstance: panel } }

  const { width, height } = DiagramSvgRenderer.renderWithOptions(doc as never, opts({ useSelection: false }))

  expect(width).toBe(200); expect(height).toBe(150) // whole content, not the 40×30 selection
})

test('renderWithOptions: useSelection=true crops to the selection bounds', () => {
  const captured: { thickness?: number } = {}
  const panel = fakePaginated([fakeVisual({ X: 0, Y: 0, Width: 200, Height: 150 })], captured)
  const doc = { ActiveView: {
    SelectionCount: 2, SelectionLeft: 5, SelectionTop: 5, SelectionWidth: 40, SelectionHeight: 30,
    ItemsPanelInstance: panel } }

  const { width, height } = DiagramSvgRenderer.renderWithOptions(doc as never, opts({ useSelection: true }))

  expect(width).toBe(40); expect(height).toBe(30)
})

test('remapColors replaces every "from" color with "to"', () => {
  const svg = '<rect fill="rgb(1,2,3)"/><path stroke="rgb(4,5,6)"/><text fill="rgb(1,2,3)">x</text>'
  const out = DiagramSvgRenderer.remapColors(svg, ['rgb(1,2,3)', 'rgb(4,5,6)'], '#ff0000')
  expect(out).toBe('<rect fill="#ff0000"/><path stroke="#ff0000"/><text fill="#ff0000">x</text>')
})
