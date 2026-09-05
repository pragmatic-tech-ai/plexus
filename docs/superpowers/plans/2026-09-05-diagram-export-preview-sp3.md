# Diagram Export — Preview Dialog (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preview dialog that shows exactly what a diagram export will contain, with controls for format (SVG/PNG/PPTX), scope, background, foreground ink, page breaks, and raster scale — reached from a single `Export…` menu item.

**Architecture:** All renderer-side, extending the SP1 `DiagramExportService` / `DiagramSvgRenderer`. A plain `ExportOptions` value object is threaded through the renderer, which applies temporary `PaginatedCanvas` overrides (page-border thickness, paper/desk fill) around its in-place tree walk and post-processes the SVG for background + foreground. A `MuralBase` dialog VM drives a live SVG-data-URL preview and resolves the chosen options; the service opens it via `DialogService` and writes the file.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/mural` (runtime/basic/visual-engine/framework), `.mu` markup, vitest, Playwright `_electron`, `pptxgenjs` (already a dep from SP1).

**Spec:** `docs/superpowers/specs/2026-09-05-diagram-export-preview-design.md`

## Global Constraints

- **Enums, not string-literal unions.** `ExportFormat`, `ExportBackground` are real TS `enum`s with explicit string values (house rule).
- **OOP.** No new module-level free functions or module-level mutable state; behavior lives as class methods (static where stateless). Existing SP1 free functions in `svg-raster.ts` are left as-is (do not restructure).
- **Every test file lives in a `tests/` subfolder** beside its source (`services/tests/…`).
- **Dialog VM extends `MuralBase`** (not `Observable`): it needs the DP system for two-way control bindings and `when ( Format = … )` template triggers — matching the sibling `SavePromptModel` / `ConfirmDialogModel`.
- **Renderer-only.** No new main-process code; the existing `fs` IPC owns the save dialog + writes.
- **Backward compatibility.** `DiagramSvgRenderer.renderDocument(doc)` and `renderPanel(panel, selection?)` keep their current behavior/signatures (used by the headless explorer export). New behavior lands in new methods.
- **`ExportFormat` re-export.** After moving the enum, `import { ExportFormat } from './diagram-export-service.js'` must still work (existing importers: `project-explorer-service.ts`, `tests/diagram-export-service.test.ts`).

Verified interfaces (exact, from the codebase):
- `DialogService.Show<T>(options: { Title?, Content: MuralBase|Visual, Width?, MaxHeight?, DismissOnScrimClick? }): Promise<T | undefined>` — resolves `undefined` on scrim/Escape. `DialogService.Key`.
- Theme resolve: `Application.current?.Resources?.Resolve(token)` → `SolidColorBrush` (has `.Color`). `Color.ToHex()` → `#rrggbb`; `Color.FromHex(hex)`; `Color.ToCss()` → `rgb(r,g,b)` / `rgba(...)`. SVG emits colors as `Color.ToCss()`.
- `PaginatedCanvas` (from `@pragmatic-tech-ai/mural/basic`) DPs: `PageBorderThickness: number`, `PaperBrush: Brush|undefined`, `Fill: Brush|undefined`. Its `RenderOverride` paints desk `Fill`, then per page a `DrawRectangle(PaperBrush, pen?, rect)` where `pen` is `undefined` when `PageBorderThickness === 0`.
- `SvgDrawingContext`: `PushTransform(TranslateTransform)`, `Pop()`, `DrawRectangle(brush, pen|undefined, Rect)`, `ToSvg(w, h)`. `Rect(X, Y, W, H)`. All from `@pragmatic-tech-ai/mural/visual-engine`.
- `BitmapImage` / `ImageSource` / `Stretch` from `@pragmatic-tech-ai/mural/visual-engine`; `Image` control (markup + `@pragmatic-tech-ai/mural/basic`) binds `Source`.
- `MuralBase.OnPropertyChanged(descriptor: PropertyDescriptor, oldValue, newValue)` — override to react to DP changes; `descriptor.Name` is the property name.
- `rasterizeSvgToPng(svg, width, height, scale=2): Promise<Uint8Array>` and `pngToDataUrl(bytes): string` in `svg-raster.ts`.
- `FileSystemService.SaveFileAs(content, opts): Promise<string|null>` and `WriteBytes(path, bytes): Promise<void>`.

---

### Task 1: `ExportOptions` value types

**Files:**
- Create: `src/renderer/src/modules/diagram-export/services/export-options.ts`
- Modify: `src/renderer/src/modules/diagram-export/services/diagram-export-service.ts` (remove the local `ExportFormat` enum; import + re-export it from `export-options.ts`)
- Test: `src/renderer/src/modules/diagram-export/services/tests/export-options.test.ts`

**Interfaces:**
- Produces: `enum ExportFormat { Svg='svg', Png='png', Pptx='pptx' }`; `enum ExportBackground { Transparent='transparent', Surface='surface' }`; `interface ExportOptions { format: ExportFormat; useSelection: boolean; background: ExportBackground; backgroundColor?: string; foreground?: string; showPageBreaks: boolean; scale: number }`; `const DEFAULT_EXPORT_OPTIONS: ExportOptions`.
- Consumes: nothing (leaf module — avoids a cycle with the service).

- [ ] **Step 1: Write the failing test**

`tests/export-options.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ExportFormat, ExportBackground, DEFAULT_EXPORT_OPTIONS } from '../export-options.js'
import { ExportFormat as ReExported } from '../diagram-export-service.js'

describe('ExportOptions', () => {
  it('ExportFormat carries the three wire values', () => {
    expect(ExportFormat.Svg).toBe('svg')
    expect(ExportFormat.Png).toBe('png')
    expect(ExportFormat.Pptx).toBe('pptx')
  })
  it('ExportBackground carries its wire values', () => {
    expect(ExportBackground.Transparent).toBe('transparent')
    expect(ExportBackground.Surface).toBe('surface')
  })
  it('defaults: SVG, whole diagram, transparent, no page breaks, 2x', () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({
      format: ExportFormat.Svg,
      useSelection: false,
      background: ExportBackground.Transparent,
      showPageBreaks: false,
      scale: 2,
    })
  })
  it('the service re-exports ExportFormat for back-compat', () => {
    expect(ReExported.Png).toBe('png')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`export-options.js` missing)

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/export-options.test.ts`
Expected: FAIL — cannot resolve `../export-options.js`.

- [ ] **Step 3: Create `export-options.ts`**

```ts
// Value types describing one diagram export. Split from the service into a leaf
// module so the renderer, the preview VM, and the service all share one option
// shape without an import cycle.

export enum ExportFormat  { Svg = 'svg', Png = 'png', Pptx = 'pptx' }
export enum ExportBackground { Transparent = 'transparent', Surface = 'surface' }

export interface ExportOptions
{
  readonly format:       ExportFormat
  readonly useSelection: boolean          // false → whole diagram even if a selection exists
  readonly background:   ExportBackground
  readonly backgroundColor?: string       // hex (#rrggbb); used when background === Surface
  readonly foreground?:  string            // hex ink override; undefined → leave as-is
  readonly showPageBreaks: boolean
  readonly scale:        number            // 1 | 2 | 3; raster (PNG/PPTX) only
}

// The dialog opens on these; the VM overrides `useSelection` when a selection exists.
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format:         ExportFormat.Svg,
  useSelection:   false,
  background:     ExportBackground.Transparent,
  showPageBreaks: false,
  scale:          2,
}
```

- [ ] **Step 4: Move the enum out of the service**

In `diagram-export-service.ts`, delete the local block:
```ts
// The two diagram export formats.
export enum ExportFormat
{
  Svg  = 'svg',
  Pptx = 'pptx',
}
```
and, next to the other imports, add:
```ts
import { ExportFormat } from './export-options.js'
```
then re-export it (below the imports, keeps existing `from './diagram-export-service.js'` importers working):
```ts
export { ExportFormat } from './export-options.js'
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/export-options.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck** (catch any missed `ExportFormat.Pptx` references)

Run: `npm run typecheck:web`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/diagram-export/services/export-options.ts \
        src/renderer/src/modules/diagram-export/services/diagram-export-service.ts \
        src/renderer/src/modules/diagram-export/services/tests/export-options.test.ts
git commit -m "feat(export): ExportOptions value types (SP3 task 1)"
```

---

### Task 2: Renderer honors `ExportOptions`

**Files:**
- Modify: `src/renderer/src/modules/diagram-export/services/diagram-svg-renderer.ts`
- Test: `src/renderer/src/modules/diagram-export/services/tests/diagram-svg-renderer.test.ts` (append)

**Interfaces:**
- Consumes: `ExportOptions`, `ExportBackground` (Task 1); `PaginatedCanvas` (`mural/basic`); `Application`, `Color` (`mural/runtime`); `SolidColorBrush` (`mural/visual-engine`).
- Produces: `DiagramSvgRenderer.renderWithOptions(doc: DiagramDocument, options: ExportOptions): { svg: string; width: number; height: number }`; `DiagramSvgRenderer.remapColors(svg: string, from: readonly string[], to: string): string` (static, pure).

- [ ] **Step 1: Write the failing tests** (append to `diagram-svg-renderer.test.ts`)

Add these imports at the top of the file (merge with the existing import lines):
```ts
import { ExportFormat, ExportBackground, type ExportOptions } from '../export-options.js'
```
Add a shared options helper + tests at the bottom:
```ts
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
```

- [ ] **Step 2: Run — expect FAIL** (`renderWithOptions` / `remapColors` undefined)

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/diagram-svg-renderer.test.ts`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Implement the renderer additions**

Extend the imports at the top of `diagram-svg-renderer.ts`:
```ts
import { Visual, Visibility, Application, Color, type DrawingContext } from '@pragmatic-tech-ai/mural/runtime'
import { Rect, SvgDrawingContext, TranslateTransform, SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'
import { PaginatedCanvas } from '@pragmatic-tech-ai/mural/basic'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { ExportBackground, type ExportOptions } from './export-options.js'
```
Add these static methods to `class DiagramSvgRenderer` (after `renderPanel`):
```ts
  // Render a document with full export options: scope (selection vs whole),
  // page-break lines, background, and foreground ink remap. Kept separate from
  // renderDocument/renderPanel so the headless explorer export is unaffected.
  public static renderWithOptions(
    doc: DiagramDocument,
    options: ExportOptions,
  ): { svg: string; width: number; height: number }
  {
    const diagram = doc.ActiveView
    if (diagram === undefined) throw new Error('diagram has no active view to export')

    const selection = options.useSelection && diagram.SelectionCount > 0
      ? new Rect(diagram.SelectionLeft, diagram.SelectionTop, diagram.SelectionWidth, diagram.SelectionHeight)
      : undefined

    return this.renderPanelWithOptions(
      diagram.ItemsPanelInstance as unknown as Visual | undefined, selection, options)
  }

  // Render an arranged items-panel under export options. Temporarily overrides the
  // PaginatedCanvas' page-border thickness and paper/desk fills (restored in a
  // `finally` so the live diagram is untouched), prepends a Surface background
  // rect when asked, and remaps the ink colors for a foreground override.
  public static renderPanelWithOptions(
    panel: Visual | undefined,
    selection: Rect | undefined,
    options: ExportOptions,
  ): { svg: string; width: number; height: number }
  {
    const pc = panel instanceof PaginatedCanvas ? panel : undefined
    const saved = pc
      ? { thickness: pc.PageBorderThickness, paper: pc.PaperBrush, fill: pc.Fill }
      : undefined
    try {
      if (pc !== undefined) {
        // Drop the per-page border lines unless the user kept them, and neutralize
        // the white paper + desk so no page chrome bleeds into the export (our own
        // background rect, if any, is painted below).
        if (!options.showPageBreaks) pc.PageBorderThickness = 0
        const transparent = new SolidColorBrush(Color.FromHex('#00000000'))
        pc.PaperBrush = transparent
        pc.Fill       = transparent
      }

      const bounds = selection ?? this.contentBounds(panel)
      const width  = Math.max(1, Math.ceil(bounds.Width))
      const height = Math.max(1, Math.ceil(bounds.Height))

      const dc = new SvgDrawingContext()
      dc.PushTransform(new TranslateTransform(-bounds.X, -bounds.Y))
      // Surface background: one opaque rect behind the tree, covering the bounds.
      if (options.background === ExportBackground.Surface && options.backgroundColor !== undefined) {
        dc.DrawRectangle(
          new SolidColorBrush(Color.FromHex(options.backgroundColor)),
          undefined,
          new Rect(bounds.X, bounds.Y, width, height))
      }
      if (panel !== undefined) this.paintVisualTree(panel, dc)
      dc.Pop()

      let svg = dc.ToSvg(width, height)
      if (options.foreground !== undefined) {
        svg = this.remapColors(svg, this.inkCssColors(), options.foreground)
      }
      return { svg, width, height }
    } finally {
      if (pc !== undefined && saved !== undefined) {
        pc.PageBorderThickness = saved.thickness
        pc.PaperBrush          = saved.paper
        pc.Fill                = saved.fill
      }
    }
  }

  // The diagram ink colors, as the exact `rgb(...)` strings SvgDrawingContext
  // emits (Color.ToCss()). Resolved from the active theme's ink tokens; empty
  // when no Application/theme is reachable (tests) so the remap is a no-op.
  public static inkCssColors(): string[]
  {
    const res = Application.current?.Resources
    const css = (token: string): string | undefined => {
      const b = res?.Resolve(token)
      return b instanceof SolidColorBrush ? b.Color.ToCss() : undefined
    }
    return ['OnSurface', 'OnSurfaceVariant']
      .map(css)
      .filter((c): c is string => c !== undefined)
  }

  // Replace every `from` color literal in the SVG with `to`. Pure string swap —
  // targeted at the ink colors so custom node fills are left alone.
  public static remapColors(svg: string, from: readonly string[], to: string): string
  {
    let out = svg
    for (const color of from) out = out.split(color).join(to)
    return out
  }
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/diagram-svg-renderer.test.ts`
Expected: PASS (existing 6 + new 6 = 12).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram-export/services/diagram-svg-renderer.ts \
        src/renderer/src/modules/diagram-export/services/tests/diagram-svg-renderer.test.ts
git commit -m "feat(export): renderer honors ExportOptions (SP3 task 2)"
```

---

### Task 3: `DiagramExportPreviewModel` (dialog VM)

**Files:**
- Create: `src/renderer/src/modules/diagram-export/services/diagram-export-preview-model.ts`
- Test: `src/renderer/src/modules/diagram-export/services/tests/diagram-export-preview-model.test.ts`

**Interfaces:**
- Consumes: `ExportOptions`, `ExportFormat`, `ExportBackground`, `DEFAULT_EXPORT_OPTIONS` (Task 1); `BitmapImage`/`ImageSource` (`mural/visual-engine`); `MuralBase`, `RelayCommand`, `ICommand`, `PropertyDescriptor` (`mural/runtime`).
- Produces: `class DiagramExportPreviewModel extends MuralBase` with constructor `(hasSelection: boolean, backgroundColor: string, render: (o: ExportOptions) => { svg: string; width: number; height: number }, close: (o: ExportOptions | undefined) => void)`; DPs `Format, UseSelection, Background, Foreground, ShowPageBreaks, Scale, HasSelection, Preview, PreviewSize`; commands `ExportCommand`, `CancelCommand`; method `currentOptions(): ExportOptions`.

Design notes for the implementer:
- `render` is injected (the service passes `(o) => DiagramSvgRenderer.renderWithOptions(doc, o)`) so the VM is testable without a live diagram.
- `backgroundColor` is the resolved `@Surface` hex, passed in by the service; used only when `Background === Surface`.
- The VM recomputes `Preview` whenever an option DP changes, via `OnPropertyChanged`.
- `Preview` is a `BitmapImage` whose `Uri` is an SVG data URL (`data:image/svg+xml;charset=utf-8,` + `encodeURIComponent(svg)`) — same encoding `svg-raster.ts` uses.

- [ ] **Step 1: Write the failing test**

`tests/diagram-export-preview-model.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { DiagramExportPreviewModel } from '../diagram-export-preview-model.js'
import { ExportFormat, ExportBackground } from '../export-options.js'

function make(over: { hasSelection?: boolean } = {}) {
  const render = vi.fn((_o) => ({ svg: '<svg>x</svg>', width: 120, height: 80 }))
  const closed: Array<unknown> = []
  const vm = new DiagramExportPreviewModel(
    over.hasSelection ?? false, '#101014', render, (o) => closed.push(o))
  return { vm, render, closed }
}

describe('DiagramExportPreviewModel', () => {
  it('renders an initial preview and reports its size', () => {
    const { vm, render } = make()
    expect(render).toHaveBeenCalledTimes(1)
    expect(vm.Preview).toBeDefined()
    expect(vm.Preview!.Uri.startsWith('data:image/svg+xml')).toBe(true)
    expect(vm.PreviewSize).toBe('120 × 80 px')
  })

  it('defaults UseSelection to whether a selection exists', () => {
    expect(make({ hasSelection: true }).vm.UseSelection).toBe(true)
    expect(make({ hasSelection: false }).vm.UseSelection).toBe(false)
    expect(make({ hasSelection: true }).vm.HasSelection).toBe(true)
  })

  it('re-renders the preview when an option changes', () => {
    const { vm, render } = make()
    render.mockClear()
    vm.Scale = 3
    expect(render).toHaveBeenCalledTimes(1)
    vm.Format = ExportFormat.Png
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('currentOptions reflects the DP state; Surface carries the bg color', () => {
    const { vm } = make()
    vm.Format = ExportFormat.Pptx
    vm.Background = ExportBackground.Surface
    vm.ShowPageBreaks = true
    vm.Scale = 1
    const o = vm.currentOptions()
    expect(o).toMatchObject({
      format: ExportFormat.Pptx, background: ExportBackground.Surface,
      backgroundColor: '#101014', showPageBreaks: true, scale: 1,
    })
  })

  it('Transparent omits the background color', () => {
    const { vm } = make()
    vm.Background = ExportBackground.Transparent
    expect(vm.currentOptions().backgroundColor).toBeUndefined()
  })

  it('ExportCommand closes with the resolved options; CancelCommand closes with undefined', () => {
    const { vm, closed } = make()
    vm.Format = ExportFormat.Png
    vm.ExportCommand.Execute(undefined)
    expect((closed[0] as { format: string }).format).toBe('png')

    const c2 = make()
    c2.vm.CancelCommand.Execute(undefined)
    expect(c2.closed[0]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/diagram-export-preview-model.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the VM**

```ts
import {
  MetaData, MuralBase, RelayCommand, type ICommand, type PropertyDescriptor,
} from '@pragmatic-tech-ai/mural/runtime'
import { BitmapImage, type ImageSource, Size } from '@pragmatic-tech-ai/mural/visual-engine'
import {
  ExportFormat, ExportBackground, DEFAULT_EXPORT_OPTIONS, type ExportOptions,
} from './export-options.js'

// View-model for the export preview dialog. Extends MuralBase (not Observable):
// the template two-way-binds each option control and uses `when ( Format = … )`
// triggers, both of which need the DP system — same as SavePromptModel.
//
// It renders a live SVG-data-URL preview through an injected `render` fn (so it is
// testable without a live diagram) whenever an option changes, and resolves the
// chosen ExportOptions on Export / undefined on Cancel.
export class DiagramExportPreviewModel extends MuralBase
{
  static readonly FormatKey = MuralBase.RegisterProperty<ExportFormat>(
    DiagramExportPreviewModel, 'Format', DEFAULT_EXPORT_OPTIONS.format, MetaData.None)
  static readonly UseSelectionKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'UseSelection', false, MetaData.None)
  static readonly BackgroundKey = MuralBase.RegisterProperty<ExportBackground>(
    DiagramExportPreviewModel, 'Background', DEFAULT_EXPORT_OPTIONS.background, MetaData.None)
  static readonly ForegroundKey = MuralBase.RegisterProperty<string | undefined>(
    DiagramExportPreviewModel, 'Foreground', undefined, MetaData.None)
  static readonly ShowPageBreaksKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'ShowPageBreaks', DEFAULT_EXPORT_OPTIONS.showPageBreaks, MetaData.None)
  static readonly ScaleKey = MuralBase.RegisterProperty<number>(
    DiagramExportPreviewModel, 'Scale', DEFAULT_EXPORT_OPTIONS.scale, MetaData.None)
  static readonly HasSelectionKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'HasSelection', false, MetaData.None)
  static readonly PreviewKey = MuralBase.RegisterProperty<ImageSource | undefined>(
    DiagramExportPreviewModel, 'Preview', undefined, MetaData.None)
  static readonly PreviewSizeKey = MuralBase.RegisterProperty<string>(
    DiagramExportPreviewModel, 'PreviewSize', '', MetaData.None)
  static readonly ExportCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportPreviewModel, 'ExportCommand', undefined as unknown as ICommand, MetaData.None)
  static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportPreviewModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

  // Which option DPs, when changed, invalidate the preview.
  private static readonly OPTION_PROPS = new Set(
    ['Format', 'UseSelection', 'Background', 'Foreground', 'ShowPageBreaks', 'Scale'])

  constructor(
    hasSelection: boolean,
    private readonly backgroundColor: string,
    private readonly render: (o: ExportOptions) => { svg: string; width: number; height: number },
    private readonly close: (o: ExportOptions | undefined) => void,
  )
  {
    super()
    this.set_property_value(DiagramExportPreviewModel.HasSelectionKey, hasSelection)
    this.set_property_value(DiagramExportPreviewModel.UseSelectionKey, hasSelection)
    this.set_property_value(DiagramExportPreviewModel.ExportCommandKey,
      new RelayCommand(() => this.close(this.currentOptions())))
    this.set_property_value(DiagramExportPreviewModel.CancelCommandKey,
      new RelayCommand(() => this.close(undefined)))
    this.recomputePreview()
  }

  public get Format(): ExportFormat { return this.get_property_value(DiagramExportPreviewModel.FormatKey) }
  public set Format(v: ExportFormat) { this.set_property_value(DiagramExportPreviewModel.FormatKey, v) }
  public get UseSelection(): boolean { return this.get_property_value(DiagramExportPreviewModel.UseSelectionKey) }
  public set UseSelection(v: boolean) { this.set_property_value(DiagramExportPreviewModel.UseSelectionKey, v) }
  public get Background(): ExportBackground { return this.get_property_value(DiagramExportPreviewModel.BackgroundKey) }
  public set Background(v: ExportBackground) { this.set_property_value(DiagramExportPreviewModel.BackgroundKey, v) }
  public get Foreground(): string | undefined { return this.get_property_value(DiagramExportPreviewModel.ForegroundKey) }
  public set Foreground(v: string | undefined) { this.set_property_value(DiagramExportPreviewModel.ForegroundKey, v) }
  public get ShowPageBreaks(): boolean { return this.get_property_value(DiagramExportPreviewModel.ShowPageBreaksKey) }
  public set ShowPageBreaks(v: boolean) { this.set_property_value(DiagramExportPreviewModel.ShowPageBreaksKey, v) }
  public get Scale(): number { return this.get_property_value(DiagramExportPreviewModel.ScaleKey) }
  public set Scale(v: number) { this.set_property_value(DiagramExportPreviewModel.ScaleKey, v) }
  public get HasSelection(): boolean { return this.get_property_value(DiagramExportPreviewModel.HasSelectionKey) }
  public get Preview(): ImageSource | undefined { return this.get_property_value(DiagramExportPreviewModel.PreviewKey) }
  public get PreviewSize(): string { return this.get_property_value(DiagramExportPreviewModel.PreviewSizeKey) }
  public get ExportCommand(): ICommand { return this.get_property_value(DiagramExportPreviewModel.ExportCommandKey) }
  public get CancelCommand(): ICommand { return this.get_property_value(DiagramExportPreviewModel.CancelCommandKey) }

  // The current DP state as an ExportOptions. Surface carries the resolved bg hex;
  // Transparent omits it.
  public currentOptions(): ExportOptions
  {
    const background = this.Background
    return {
      format:         this.Format,
      useSelection:   this.UseSelection,
      background,
      backgroundColor: background === ExportBackground.Surface ? this.backgroundColor : undefined,
      foreground:     this.Foreground,
      showPageBreaks: this.ShowPageBreaks,
      scale:          this.Scale,
    }
  }

  protected override OnPropertyChanged(
    descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
  {
    super.OnPropertyChanged(descriptor, oldValue, newValue)
    if (DiagramExportPreviewModel.OPTION_PROPS.has(descriptor.Name)) this.recomputePreview()
  }

  private recomputePreview(): void
  {
    const { svg, width, height } = this.render(this.currentOptions())
    const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    this.set_property_value(DiagramExportPreviewModel.PreviewKey,
      new BitmapImage(uri, new Size(width, height)))
    this.set_property_value(DiagramExportPreviewModel.PreviewSizeKey, `${width} × ${height} px`)
  }
}

export default DiagramExportPreviewModel
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/diagram-export-preview-model.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck** — `npm run typecheck:web` (no errors)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram-export/services/diagram-export-preview-model.ts \
        src/renderer/src/modules/diagram-export/services/tests/diagram-export-preview-model.test.ts
git commit -m "feat(export): preview dialog view-model (SP3 task 3)"
```

---

### Task 4: PNG export + `OpenExportDialogCommand` on the service

**Files:**
- Modify: `src/renderer/src/modules/diagram-export/services/diagram-export-service.ts`
- Test: `src/renderer/src/modules/diagram-export/services/tests/diagram-export-service.test.ts` (append)

**Interfaces:**
- Consumes: `ExportOptions`, `ExportFormat`, `ExportBackground` (Task 1); `DiagramSvgRenderer.renderWithOptions` (Task 2); `DiagramExportPreviewModel` (Task 3); `DialogService` (`mural/framework`); `Application`, `Color`, `SolidColorBrush`; `rasterizeSvgToPng` (`svg-raster.ts`).
- Produces: `DiagramExportService.OpenExportDialogCommand` (ICommand DP); `exportRendered(format, rendered, baseName, scale?)` now also handles `ExportFormat.Png`.

Design notes:
- `exportRendered` gains an optional `scale = 2` used by PNG and PPTX.
- PNG save mirrors PPTX (UTF-8 `SaveFileAs('')` → path, then `WriteBytes`).
- `OpenExportDialogCommand` runs `openExportDialog()`: resolve the active diagram; build the preview VM with `render = (o) => DiagramSvgRenderer.renderWithOptions(doc, o)`, `hasSelection = doc.ActiveView.SelectionCount > 0`, `backgroundColor = surfaceHex()`; `DialogService.Show({ Title:'Export diagram', Content: vm, Width: 720, MaxHeight: 560 })`; on a resolved `ExportOptions`, render final and call `exportRendered(o.format, rendered, baseName, o.scale)`.
- `surfaceHex()`: resolve `@Surface` → `SolidColorBrush.Color.ToHex()`, default `'#1c1b1f'` when no theme.

- [ ] **Step 1: Write the failing tests** (append to `diagram-export-service.test.ts`)

Read the existing test file first to reuse its harness (service construction, fake provider, fake `FileSystemService`). Add:
```ts
import { ExportBackground } from '../export-options.js'

// (Reuse the file's existing helpers to build a service with a fake provider +
// fake FileSystemService that records SaveFileAs/WriteBytes. If the existing file
// exposes them differently, adapt these two tests to that harness.)

test('exportRendered(Png) rasterizes and writes PNG bytes via WriteBytes', async () => {
  const writes: Array<{ path: string; bytes: Uint8Array }> = []
  const fs = {
    SaveFileAs: async (_c: string, _o: unknown) => 'C:/out/diagram.png',
    WriteBytes: async (path: string, bytes: Uint8Array) => { writes.push({ path, bytes }) },
  }
  const svc = makeService(fs) // helper from the existing file
  await svc.exportRendered(ExportFormat.Png, { svg: '<svg width="4" height="4"/>', width: 4, height: 4 }, 'diagram', 2)
  expect(writes.length).toBe(1)
  expect(writes[0].path).toBe('C:/out/diagram.png')
  // PNG magic: 0x89 'P' 'N' 'G'
  expect(Array.from(writes[0].bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
})

test('OpenExportDialogCommand is present and gated by an active diagram', () => {
  const svc = makeService()          // no active diagram
  expect(svc.OpenExportDialogCommand).toBeDefined()
  expect(svc.OpenExportDialogCommand.CanExecute(undefined)).toBe(false)
})
```
> If the existing test file has no `makeService` helper, add a small one at the top of the file that mirrors how the existing tests instantiate `DiagramExportService` (fake `IServiceProvider` returning the fake `FileSystemService` for `FileSystemService.Key` and `undefined` for `ContentHostService.Key`). The `exportRendered` PNG test needs only the fake `fs`; the rasterizer runs in jsdom/happy-dom — verify `vitest.config.ts` uses a DOM environment for this folder, and if not, keep the PNG assertion to "WriteBytes called with a Uint8Array" and move the magic-byte check to the Playwright e2e in Task 6.

- [ ] **Step 2: Run — expect FAIL** (`ExportFormat.Png` unhandled → falls to PPTX path; `OpenExportDialogCommand` undefined)

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/diagram-export-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement PNG + the dialog command**

In `diagram-export-service.ts`:

Add imports:
```ts
import { Application, Color } from '@pragmatic-tech-ai/mural/runtime'
import { SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'
import { DialogService, DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { DiagramExportPreviewModel } from './diagram-export-preview-model.js'
import { ExportBackground, type ExportOptions } from './export-options.js'
```

Register the command DP (next to the existing command keys):
```ts
  public static readonly OpenExportDialogCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportService, 'OpenExportDialogCommand', undefined as unknown as ICommand, MetaData.None)
```
In the constructor, after the existing command wiring:
```ts
    this.set_property_value(DiagramExportService.OpenExportDialogCommandKey,
      new RelayCommand(() => { void this.openExportDialog() }, gate))
```
Add the getter:
```ts
  public get OpenExportDialogCommand(): ICommand { return this.get_property_value(DiagramExportService.OpenExportDialogCommandKey) }
```

Change `exportRendered` to route PNG and accept a scale:
```ts
  public async exportRendered(
    format: ExportFormat,
    rendered: { svg: string; width: number; height: number },
    baseName: string,
    scale = 2,
  ): Promise<void>
  {
    if (format === ExportFormat.Svg)  return this.saveSvg(rendered.svg, baseName)
    if (format === ExportFormat.Png)  return this.savePng(rendered, baseName, scale)
    return this.savePptx(rendered, baseName, scale)
  }
```
Add `savePng` (mirrors `savePptx`'s path-then-bytes) and give `savePptx` the `scale`:
```ts
  private async savePng(
    rendered: { svg: string; width: number; height: number },
    baseName: string,
    scale: number,
  ): Promise<void>
  {
    const { svg, width, height } = rendered
    const png = await rasterizeSvgToPng(svg, width, height, scale)
    const fs = this.Provider.getRequired(FileSystemService.Key)
    const path = await fs.SaveFileAs('', {
      Title:       'Export as PNG',
      DefaultPath: `${baseName}.png`,
      Filters:     [{ Name: 'PNG Image', Extensions: ['png'] }],
    })
    if (path !== null) await fs.WriteBytes(path, png)
  }
```
Update `savePptx`'s signature to `(rendered, baseName, scale = 2)` and pass `scale` into its existing `rasterizeSvgToPng(svg, width, height, scale)` call (it currently hard-codes `2`).

Add the dialog opener + a surface-hex helper:
```ts
  // Open the preview dialog for the active diagram, then export with the chosen
  // options. No-op when there is no active diagram or no DialogService.
  protected async openExportDialog(): Promise<void>
  {
    const doc = this.activeDiagram()
    if (doc === undefined) return
    const dialogs = this.Provider.get(DialogService.Key) as DialogService | undefined
    if (dialogs === undefined) return

    const baseName = doc.Title || 'diagram'
    const hasSelection = (doc.ActiveView?.SelectionCount ?? 0) > 0
    const vm = new DiagramExportPreviewModel(
      hasSelection,
      this.surfaceHex(),
      (o: ExportOptions) => DiagramSvgRenderer.renderWithOptions(doc, o),
      (o?: ExportOptions) => dialogs.Close(o))

    const chosen = await dialogs.Show<ExportOptions>({
      Title: 'Export diagram', Content: vm, Width: 720, MaxHeight: 560,
    })
    if (chosen === undefined) return
    const rendered = DiagramSvgRenderer.renderWithOptions(doc, chosen)
    await this.exportRendered(chosen.format, rendered, baseName, chosen.scale)
  }

  // The active theme's Surface color as hex, for the Surface-background option.
  private surfaceHex(): string
  {
    const b = Application.current?.Resources?.Resolve('Surface')
    return b instanceof SolidColorBrush ? b.Color.ToHex() : '#1c1b1f'
  }
```
> `activeDiagram()` returns a `DiagramDocument`; `ActiveView.SelectionCount` is read in `DiagramSvgRenderer` already, so the shape is available. `DialogService.Close(o)` resolves the `Show` promise with the options.

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npx vitest run src/renderer/src/modules/diagram-export/services/tests/diagram-export-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck** — `npm run typecheck:web` (no errors)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram-export/services/diagram-export-service.ts \
        src/renderer/src/modules/diagram-export/services/tests/diagram-export-service.test.ts
git commit -m "feat(export): PNG format + OpenExportDialogCommand (SP3 task 4)"
```

---

### Task 5: Preview dialog template + resource wiring

**Files:**
- Create: `src/renderer/src/modules/diagram-export/diagram-export-preview.resources.mu`
- Modify: `package.json` (add the `.resources.mu` to the `compile:mu` file list)
- Modify: `src/renderer/src/app.mu` (import + `merge` the new resources dictionary)

**Interfaces:**
- Consumes: `DiagramExportPreviewModel` (Task 3) — its DPs `Format`, `UseSelection`, `Background`, `Foreground`, `ShowPageBreaks`, `Scale`, `HasSelection`, `Preview`, `PreviewSize`, and `ExportCommand`/`CancelCommand`; `ExportFormat`/`ExportBackground` enum members for trigger/radio values.
- Produces: `DataTemplate [ DataType = DiagramExportPreviewModel ]` merged app-global so `DialogService.Show({ Content: vm })` renders it.

Design notes:
- Model the file on `src/renderer/src/services/dialogs/save-prompt.resources.mu` (import the VM, a `resources { DataTemplate [ DataType = … ] { … } }` block).
- Radios: use the control the codebase already uses for exclusive choice (grep `RadioButton`/`SegmentedControl` in `src/renderer/src` and mural `basic`; pick whichever the app uses for enum selection — e.g. bind `IsChecked` to `$Format = ExportFormat.Svg` style, or a `SegmentedControl` bound two-way to the enum DP). If no radio primitive exists, use `Button`s that set the DP via small commands — but prefer the existing primitive.
- Preview `Image [ Source = $Preview, Stretch = Uniform ]` inside a bordered `Border` with a neutral fill (`@SurfaceContainerHigh`) as the transparency backdrop (checkerboard is a later nicety — spec open item #2).
- Scale row: wrap in a container whose `IsEnabled = $Format` differs from Svg — express as `when ( Format = ExportFormat.Svg ) { PART_ScaleRow.IsEnabled = false }` if the template supports triggers on the data type; otherwise leave always-enabled (SVG simply ignores scale) and note it.
- Selection option visibility: `when ( HasSelection = false ) { PART_SelectionOption.Visibility = Collapsed }`.
- Buttons row mirrors save-prompt: `Cancel` (Text) + `Export` (Filled) bound to `$CancelCommand` / `$ExportCommand`.

- [ ] **Step 1: Author the template**

Create `diagram-export-preview.resources.mu`. Concretely (adjust control names to the app's actual primitives found via grep — the structure and bindings are what matter):
```
// diagram-export-preview.resources.mu — the export preview dialog body.
// Renders DiagramExportPreviewModel as DialogService modal content: a live
// preview on the left, the export options on the right, Cancel / Export below.
// Mirrors save-prompt.resources.mu.

import DiagramExportPreviewModel from "./services/diagram-export-preview-model.js"

resources DiagramExportPreviewResources {

    DataTemplate [ DataType = DiagramExportPreviewModel ] {
        DockPanel [ LastChildFill = true ] {
            // Actions row (bottom)
            StackPanel [ DockPanel.Dock = Bottom, Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,16,0,0) ] {
                Button [ Variant = Text,   Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ExportCommand ] { TextBlock [ Text = "Export" ] }
            }
            // Preview (left)
            Border [ DockPanel.Dock = Left, Width = 420, MinHeight = 300, Fill = @SurfaceContainerHigh,
                     CornerRadius = @ShapeSmall, Margin = (0,0,16,0), Padding = (8) ] {
                StackPanel [ Orientation = Vertical, HorizontalAlignment = Center, VerticalAlignment = Center ] {
                    Image [ Source = $Preview, Stretch = Uniform ]
                    TextBlock [ Text = $PreviewSize, Style = @BodySmall, Foreground = @OnSurfaceVariant,
                                HorizontalAlignment = Center, Margin = (0,8,0,0) ]
                }
            }
            // Options (right, fills remaining) — Format / Scope / Background / Foreground / Page breaks / Scale.
            // Use the app's existing exclusive-choice control for the enum groups; bind two-way to the DPs
            // ($Format, $Background) and the booleans ($UseSelection, $ShowPageBreaks). Foreground binds a
            // color swatch to $Foreground (nullable → "leave as-is"); Scale binds to $Scale (1|2|3).
            StackPanel [ Orientation = Vertical ] {
                // ... option rows here (see Design notes) ...
                // Selection option gated:
                StackPanel x:name="PART_SelectionOption" [ Orientation = Horizontal ] { /* Scope radios */ }
            }
        }
        when ( HasSelection = false ) { PART_SelectionOption.Visibility = Collapsed }
    }
}
```
> Fill in the option rows with the concrete controls discovered by grep. Keep every visible element bound/templated (house rule — no hardcoded chrome beyond layout). Register any enum members you reference (`ExportFormat`, `ExportBackground`) the same way other Plexus `.mu` files reference enums (import the module; mural resolves members).

- [ ] **Step 2: Add the file to `compile:mu`**

In `package.json`, append the new path to the `compile:mu` script's argument list (before `src/renderer/src/app.mu`):
```
src/renderer/src/modules/diagram-export/diagram-export-preview.resources.mu
```

- [ ] **Step 3: Merge it in `app.mu`**

Add an import beside the other `*.resources.mu.js` imports:
```
import DiagramExportPreviewResources from "./modules/diagram-export/diagram-export-preview.resources.mu.js"
```
and, in the resources `merge` block (next to `merge SavePromptResources`):
```
        merge DiagramExportPreviewResources
```

- [ ] **Step 4: Compile the markup — expect success**

Run: `npm run compile:mu`
Expected: "compiled N files" with no error; a `diagram-export-preview.resources.mu.js` appears next to the source.

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck:web && npx electron-vite build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/modules/diagram-export/diagram-export-preview.resources.mu \
        src/renderer/src/modules/diagram-export/diagram-export-preview.resources.mu.js \
        package.json src/renderer/src/app.mu src/renderer/src/app.mu.js
git commit -m "feat(export): preview dialog template + resource wiring (SP3 task 5)"
```

---

### Task 6: Single `Export…` menu item + e2e

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu` (context menu, lines ~340-342)
- Modify: `src/renderer/src/window/title-bar.resources.mu` (File menu Export submenu)
- Test: `e2e/diagram-export-preview.spec.ts` (new Playwright `_electron` spec)

**Interfaces:**
- Consumes: `DiagramExportService.OpenExportDialogCommand` (Task 4); the preview template (Task 5).
- Produces: both menus expose one `Export…` item; the `Export ▸ SVG/PPTX` submenu is gone.

- [ ] **Step 1: Replace the context-menu submenu**

In `diagram.resources.mu`, replace:
```
        MenuItem [ Header = "Export" ] {
            MenuItem [ Header = "Vector Graphics (SVG)", Command = $service(DiagramExportService).ExportSvgCommand ]
            MenuItem [ Header = "PowerPoint (PPTX)",     Command = $service(DiagramExportService).ExportPptxCommand ]
        }
```
with:
```
        MenuItem [ Header = "Export…", Command = $service(DiagramExportService).OpenExportDialogCommand ]
```

- [ ] **Step 2: Replace the File-menu Export submenu**

In `title-bar.resources.mu`, find the `File` menu's `Export ▸ SVG / PPTX` items (they bind `ExportSvgCommand` / `ExportPptxCommand`) and replace them with a single:
```
        MenuItem [ Header = "Export…", Command = $service(DiagramExportService).OpenExportDialogCommand ]
```
(keep the surrounding File-menu structure intact).

- [ ] **Step 3: Compile + build**

Run: `npm run compile:mu && npx electron-vite build`
Expected: both succeed.

- [ ] **Step 4: Write the e2e spec**

Model it on the existing SP1/SP2 export e2e (grep `e2e/` for the export spec that drives right-click → Export, and reuse its `launchPlexus`/seed/open-diagram harness). `e2e/diagram-export-preview.spec.ts`:
```ts
// Opens a seeded diagram, invokes Export… (via the service command through the
// context menu or the File menu — reuse the existing export spec's menu-driving
// helper), asserts the preview dialog appears, flips format to PNG and scale to 3,
// clicks Export, and asserts a PNG file is written to the chosen path (stub the
// save path via the same fs hook the SP1 export e2e uses).
```
Fill the body using the SP1 export e2e's helpers (menu open, `_electron` introspection via `Symbol.for('mural:visual-backref')`, and the fs save stub). Assertions: (1) a visual bound to `DiagramExportPreviewModel` mounts after `Export…`; (2) after choosing PNG + Export, the fs layer received a `.png` write with PNG magic bytes.

- [ ] **Step 5: Run the e2e**

Run: `node node_modules/@playwright/test/cli.js test e2e/diagram-export-preview.spec.ts`
Expected: PASS. (Use this invocation, not `npx playwright test`, to avoid the version-mismatch trap noted in the repo.)

- [ ] **Step 6: Full test sweep + typecheck**

Run: `npx vitest run src/renderer/src/modules/diagram-export && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/modules/diagram/diagram.resources.mu \
        src/renderer/src/modules/diagram/diagram.resources.mu.js \
        src/renderer/src/window/title-bar.resources.mu \
        src/renderer/src/window/title-bar.resources.mu.js \
        e2e/diagram-export-preview.spec.ts
git commit -m "feat(export): single Export… entry opens the preview dialog (SP3 task 6)"
```

---

## Self-Review

**Spec coverage:**
- Single `Export…` entry (both menus) → Task 6. ✅
- Formats SVG/PNG/PPTX → Task 1 (enum) + Task 4 (PNG in `exportRendered`). ✅
- Scope selection/whole → Task 2 (renderer `useSelection`) + Task 3 (VM `UseSelection`/`HasSelection`). ✅
- Background transparent/surface → Task 2 (bg rect + paper neutralize) + Task 3 (VM). ✅
- Foreground ink remap → Task 2 (`inkCssColors`/`remapColors`) + Task 3 (VM `Foreground`). ✅
- Page breaks toggle → Task 2 (`PageBorderThickness=0`) + Task 3 (VM). ✅
- Scale 1/2/3 → Task 2/4 (raster scale) + Task 3 (VM). ✅
- Live SVG-data-URL preview → Task 3 (`recomputePreview`) + Task 5 (`Image`). ✅
- Dialog via DialogService → Task 4 (`openExportDialog`). ✅

**Type consistency:** `ExportOptions` fields identical across Tasks 1-4; `renderWithOptions(doc, options)` produced in Task 2 consumed in Tasks 3-4; VM ctor `(hasSelection, backgroundColor, render, close)` produced in Task 3 consumed in Task 4; `exportRendered(format, rendered, baseName, scale?)` consistent Tasks 4/6. `DialogService.Show`/`Close` signatures match the verified interface.

**Open items surfaced for the implementer (from the spec, resolve in-task):** the exact exclusive-choice control for the enum radios and the scale-row disable trigger (Task 5, via grep); whether `vitest` runs this folder under a DOM env for the PNG magic-byte assert (Task 4, else defer that assert to the e2e); the checkerboard backdrop is intentionally deferred to a plain neutral fill.
