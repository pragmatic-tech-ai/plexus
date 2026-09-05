import { Visual, Visibility, Application, Color, type DrawingContext } from '@pragmatic-tech-ai/mural/runtime'
import { Rect, SvgDrawingContext, TranslateTransform, SolidColorBrush, type Brush } from '@pragmatic-tech-ai/mural/visual-engine'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { ExportBackground, type ExportOptions } from './export-options.js'

// The subset of PaginatedCanvas (the diagram's ItemsPanel) the export overrides
// touch. Duck-typed rather than `instanceof PaginatedCanvas` so the renderer stays
// consistent with its already-duck-typed tree walk (paintVisualTree reads only
// public Visual members) — and so the fake-based renderer tests can exercise the
// page-break / paper overrides without arranging a real canvas.
interface PaginatedCanvasLike
{
  PageBorderThickness: number
  PaperBrush: Brush | undefined
  Fill: Brush | undefined
}

// ── Rendering approach ─────────────────────────────────────────────────────────
// We CANNOT hand the live diagram's ItemsPanelInstance to a HeadlessTarget:
// PresentationTarget's ctor calls SetTarget on the content visual, which throws
// "Visual is already attached to a host" because that panel is still mounted in
// the live diagram. Instead we walk the (already-arranged) visual tree in place
// and paint each node into an SvgDrawingContext — a faithful, read-only replica
// of HeadlessTarget.renderTree (translate by ArrangedRect, honour Clip/ChildClip,
// call Render, recurse). Nothing is reparented, so the live view is untouched.
//
// The tree is rendered at canvas-space coordinates (the panel sits BELOW the
// camera transform), so we shift the context by (-bounds.X, -bounds.Y) first,
// mapping the chosen bounds' top-left to (0,0); ToSvg(w,h) then emits
// viewBox="0 0 w h", cropping the SVG to those bounds.
//
// Content bounds come from the panel's ARRANGED children, not from doc.Nodes: a
// diagram's content VMs (NodeViewModel / ArchNodeVM) carry NO geometry — their
// container Figures own it, and those exist only once the Diagram has arranged
// them. The panel's visual children ARE those arranged figures (plus connector
// visuals, which mount into the same panel), each carrying a canvas-space
// ArrangedRect. Reading geometry off doc.Nodes yields a zero rect → a 1×1 SVG.
// ─────────────────────────────────────────────────────────────────────────────

// Shared SVG renderer for a diagram's visual tree, used by both the live-editor
// export (DiagramExportService) and the headless explorer export
// (DiagramHeadlessRenderer). Stateless — all members are static.
export class DiagramSvgRenderer
{
  // Render a document's active view — the selection if any items are selected,
  // else the whole arranged content — to an SVG string sized to those bounds with
  // the origin at (0,0). Throws if the document has no active view.
  public static renderDocument(doc: DiagramDocument): { svg: string; width: number; height: number }
  {
    const diagram = doc.ActiveView
    if (diagram === undefined) throw new Error('diagram has no active view to export')

    const selection = diagram.SelectionCount > 0
      ? new Rect(diagram.SelectionLeft, diagram.SelectionTop, diagram.SelectionWidth, diagram.SelectionHeight)
      : undefined

    return this.renderPanel(diagram.ItemsPanelInstance as unknown as Visual | undefined, selection)
  }

  // Render an arranged items-panel to SVG. `selection`, when given, crops to that
  // canvas-space rect; otherwise the panel's arranged content box is used. The
  // headless renderer calls this directly with its offscreen panel (no selection).
  public static renderPanel(
    panel: Visual | undefined,
    selection?: Rect,
  ): { svg: string; width: number; height: number }
  {
    const bounds = selection ?? this.contentBounds(panel)
    const width  = Math.max(1, Math.ceil(bounds.Width))
    const height = Math.max(1, Math.ceil(bounds.Height))

    const dc = new SvgDrawingContext()

    // Map content origin → (0,0): translate by -bounds.X / -bounds.Y so the chosen
    // bounds' top-left lands at the SVG's coordinate origin, then paint the live
    // tree in place (no reparenting — see the header note).
    dc.PushTransform(new TranslateTransform(-bounds.X, -bounds.Y))
    if (panel !== undefined) this.paintVisualTree(panel, dc)
    dc.Pop()

    return { svg: dc.ToSvg(width, height), width, height }
  }

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
  // `finally` so the live diagram is untouched), prepends a Surface background rect
  // when asked, and remaps the ink colors for a foreground override.
  public static renderPanelWithOptions(
    panel: Visual | undefined,
    selection: Rect | undefined,
    options: ExportOptions,
  ): { svg: string; width: number; height: number }
  {
    const pc = this.asPaginated(panel)
    const saved = pc !== undefined
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

  // Treat a panel as a PaginatedCanvas when it exposes the page DPs the overrides
  // touch. Duck-typed (see PaginatedCanvasLike) — the live diagram's ItemsPanel is
  // always a PaginatedCanvas, and no other panel exposes PageBorderThickness.
  private static asPaginated(panel: Visual | undefined): PaginatedCanvasLike | undefined
  {
    const p = panel as unknown as Partial<PaginatedCanvasLike> | undefined
    return p !== undefined && typeof p.PageBorderThickness === 'number'
      ? (p as PaginatedCanvasLike)
      : undefined
  }

  // The diagram ink colors, as the exact `rgb(...)` strings SvgDrawingContext emits
  // (Color.ToCss()). Resolved from the active theme's ink tokens; empty when no
  // Application/theme is reachable (tests) so the remap is a no-op.
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

  // Union of the panel's arranged children (canvas-space). Returns a zero Rect
  // when the panel is absent or has no arranged content.
  public static contentBounds(panel: Visual | undefined): Rect
  {
    if (panel === undefined) return new Rect(0, 0, 0, 0)

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const child of panel.visualChildren) {
      const r = child.ArrangedRect
      if (r.Width <= 0 || r.Height <= 0) continue
      minX = Math.min(minX, r.X); minY = Math.min(minY, r.Y)
      maxX = Math.max(maxX, r.X + r.Width); maxY = Math.max(maxY, r.Y + r.Height)
    }
    if (!Number.isFinite(minX)) return new Rect(0, 0, 0, 0)
    return new Rect(minX, minY, maxX - minX, maxY - minY)
  }

  // Paint a visual subtree into `dc` without taking ownership of it — mirrors
  // HeadlessTarget.renderTree using only public Visual APIs.
  public static paintVisualTree(visual: Visual, dc: DrawingContext): void
  {
    if (visual.Visibility !== Visibility.Visible) return

    const rect = visual.ArrangedRect
    const needsTranslate = rect.X !== 0 || rect.Y !== 0
    if (needsTranslate) dc.PushTransform(new TranslateTransform(rect.X, rect.Y))

    const clip = visual.Clip
    if (clip !== undefined) dc.PushClip(clip)

    visual.Render(dc)

    const childClip = visual.ChildClip
    if (childClip !== undefined) dc.PushClip(childClip)
    for (const child of visual.visualChildren) this.paintVisualTree(child, dc)
    if (childClip !== undefined) dc.Pop()

    if (clip !== undefined) dc.Pop()
    if (needsTranslate) dc.Pop()
  }
}
