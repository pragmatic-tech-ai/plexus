# Plexus Diagram Export — Preview Dialog (SP3)

**Status**: Design — approved forks, pending spec review
**Date**: 2026-09-05
**Builds on**: `2026-09-04-diagram-export.md` (SP1 engine + context menu, SP2 File menu)

## 1. Goal

Before writing a file, show the user a **preview dialog** of exactly what will be
exported, with controls to choose the **format** and tune the output. The two
menu surfaces (diagram context menu + title-bar File menu) collapse their
`Export ▸ SVG / PPTX` submenu into a single **`Export…`** entry that opens this
dialog; format is chosen inside it.

The dialog previews the same render the file will contain (selection-or-whole),
re-rendering live as options change, and exports on confirm.

## 2. Locked Decisions

| Fork | Decision |
| --- | --- |
| Entry point | **Single `Export…`** in both menus → opens the dialog. The `Export ▸ SVG/PPTX` submenu is removed. |
| Formats | **SVG, PNG, PPTX.** PNG is new (reuses the SP1 raster pipeline). |
| Scope | Toggle **Selection vs Whole diagram** (Selection option shown only when something is selected). |
| Background | Toggle **Transparent vs Surface** (solid fill). |
| Foreground | A **color override for the diagram ink** (labels + default connector strokes), via targeted SVG color-remap. Default = leave as-is. |
| Page breaks | Checkbox to **include/exclude the per-page border lines** (today's exports include them). Default = excluded. |
| Scale | **1× / 2× / 3×** multiplier for raster output (PNG/PPTX); ignored for SVG. |
| Preview | Live **SVG data-URL** into an `ImageSource` (crisp vector; no raster round-trip in the preview). |

## 3. Architecture

All renderer-side, extending SP1. No new main-process code (the existing `fs`
IPC still owns the save dialog + writes). Four parts:

1. **`ExportOptions`** — a value object carrying every choice.
2. **Renderer options** — `DiagramSvgRenderer` applies the options while walking
   the live tree.
3. **Preview dialog** — `DiagramExportPreviewModel` (VM) + a `resources.mu`
   template, shown through `DialogService`.
4. **Command + menu change** — `OpenExportDialogCommand` on `DiagramExportService`;
   both menus bind the single `Export…` to it.

### 3.1 `ExportOptions`

`src/renderer/src/modules/diagram-export/services/export-options.ts`

```
enum ExportFormat     { Svg='svg', Png='png', Pptx='pptx' }   // extends SP1 enum
enum ExportBackground { Transparent='transparent', Surface='surface' }

interface ExportOptions {
  format:      ExportFormat
  useSelection:boolean            // false → whole diagram (even if a selection exists)
  background:  ExportBackground
  backgroundColor?: string        // resolved Surface hex when background=Surface
  foreground?: string             // ink override hex; undefined = leave as-is
  showPageBreaks: boolean
  scale:       number             // 1|2|3; raster only
}
```

Formats/backgrounds are **enums** (house rule: no string-literal unions).

### 3.2 Renderer options — `DiagramSvgRenderer`

`renderPanel(panel, selection?)` gains an `options` argument and applies, around
the in-place tree walk, **temporary overrides on the `PaginatedCanvas` panel that
are restored in a `finally`** (the panel's `RenderOverride` paints the paper +
per-page borders, which is why today's exports capture them):

- **Page breaks** — `showPageBreaks=false` ⇒ set `PageBorderThickness = 0` for the
  render (drops the border lines; restored after).
- **Background** — neutralize the panel's white `PaperBrush` and desk `Fill` for
  the render so no white pages bleed in. `Transparent` paints nothing behind;
  `Surface` **prepends one solid rect** (`backgroundColor`, full content size)
  before the tree.
- **Scope** — `useSelection` chooses the selection rect vs the whole content
  bounds explicitly (overriding SP1's auto "selection-if-any").
- **Foreground** — see §3.3.
- **Scale** — not a render concern; passed to the rasterizer at export time.

Signature stays backward-compatible: `renderDocument(doc)` keeps its current
behavior by passing default options (auto-scope, page breaks on, no bg, no ink
override), so SP1/SP2 callers are unchanged.

### 3.3 Foreground ink remap

The diagram's ink resolves from theme tokens — `ShapeLabelInk → OnSurface`,
`ConnectorDefaultStroke → OnSurfaceVariant` (light ink for the dark app) — and
those colors are **baked into the already-arranged visuals**, so a settings flip
cannot retint them. Approach: **targeted post-render color-remap**. Resolve the
current theme's `OnSurface` + `OnSurfaceVariant` hex values; when `foreground` is
set, replace those exact colors in the emitted SVG string with the chosen color.
Precise for label/connector ink; leaves custom node fills alone.

**Assumption (confirm in review):** "foreground color" means *recolor the ink
tokens* (labels + default connector strokes), NOT "force every stroke to one
color." The remap is scoped to the two resolved ink hexes.

### 3.4 Preview dialog — VM + template

`src/renderer/src/modules/diagram-export/services/diagram-export-preview-model.ts`

`DiagramExportPreviewModel extends MuralBase` — bindable DPs for each control
(`Format`, `UseSelection`, `Background`, `Foreground`, `ShowPageBreaks`, `Scale`),
the derived `Preview` (`ImageSource`), a `PreviewSize` label, `HasSelection`
(gates the Selection option), and `ExportCommand`/`CancelCommand`. It holds the
rendered panel/bounds and, on any option change, recomputes `Preview` from
`DiagramSvgRenderer` as an SVG data-URL. `ExportCommand` resolves the final
`ExportOptions` and closes the dialog with it; `CancelCommand` closes with
`undefined`.

*VM base rationale:* deviates from the house "VMs extend `Observable`" default
because the dialog genuinely needs the DP system — two-way control bindings and
`when ( Format = … )` template triggers — matching the sibling `SavePromptModel`
/ `ConfirmDialogModel`.

`src/renderer/src/modules/diagram-export/diagram-export-preview.resources.mu` —
`DataTemplate [ DataType = DiagramExportPreviewModel ]`: preview `Image` in a
bordered box on the left (checkerboard fill behind it so Transparent reads as
transparent), the controls on the right, `Cancel` / `Export` (Filled) row at the
bottom. Scale row greys out for `Format = Svg`; the Selection option is collapsed
when `HasSelection = false`. Mirrors the `save-prompt.resources.mu` pattern.

```
┌─ Export diagram ──────────────────────────────────────────┐
│ ┌───────────────────────────┐  Format  ( )SVG (•)PNG ( )PPTX│
│ │      live preview         │  Scope   ( )Selection (•)Whole│
│ │   (checkerboard behind    │  Background (•)Transparent ( )Surface│
│ │    when transparent)      │  Foreground [■]  [ Reset ]    │
│ │   1240 × 720 px · 2×      │  [✓] Page breaks              │
│ └───────────────────────────┘  Scale ( )1× (•)2× ( )3×      │
│                              [ Cancel ]        [ Export ]    │
└────────────────────────────────────────────────────────────┘
```

### 3.5 Command + menu change

- `DiagramExportService` gains `OpenExportDialogCommand` (gated by
  `canExportActive`). It renders the active diagram once, builds the VM, and
  `DialogService.Show`s it; on a resolved `ExportOptions` it renders the final
  output with those options and calls `exportRendered`.
- `exportRendered(format, rendered, baseName, scale?)` extends to a **third
  format, PNG**: `rasterizeSvgToPng` → `WriteBytes` (like PPTX's path-then-bytes,
  since `SaveFileAs` is UTF-8 only). Filter `{ Name:'PNG Image', Extensions:['png'] }`.
- **Menus:** in `diagram.resources.mu` and `title-bar.resources.mu`, replace the
  `Export` submenu (two child items) with one
  `MenuItem [ Header = "Export…", Command = $service(DiagramExportService).OpenExportDialogCommand ]`.
  The old `ExportSvgCommand` / `ExportPptxCommand` stay on the service (still used
  by the headless explorer export and any direct callers).

## 4. Decomposition

One sub-project on top of SP1/SP2:

- **SP3 — Export preview dialog.** `ExportOptions`; renderer option plumbing
  (page breaks, background, scope, foreground remap); PNG in `exportRendered`;
  the preview VM + template; `OpenExportDialogCommand`; the two menu edits.
  Verifiable end-to-end: `Export…` → tune → preview updates → save file on disk.

## 5. Open Items (resolve during planning)

1. **`DialogService` sizing** — confirm `DialogOptions` supports a comfortable
   fixed width/height for the preview (SP1 only set `Width`); the content can
   otherwise self-size.
2. **Checkerboard** — cheapest way to paint the transparency checkerboard behind
   the preview `Image` (a tiled brush vs a static resource); fall back to a plain
   subdued fill if tiling isn't readily available.
3. **Background/paper interaction** — verify neutralizing `PaperBrush`/`Fill`
   during export doesn't disturb the live diagram (overrides are restored in
   `finally`, but confirm no async render races).
4. **Foreground remap fidelity** — the two ink hexes may collide with a node that
   legitimately uses the same color; accept for v1, note in UI copy if needed.
5. **Preview debounce** — dragging the foreground swatch shouldn't re-render per
   pixel; throttle preview recompute if it's perceptibly slow.

## 6. Testing

- **Renderer options** (unit, in `services/tests/`): page-breaks off ⇒ emitted SVG
  has no page-border stroke; `Surface` ⇒ a leading background `<rect>` of the
  chosen color, `Transparent` ⇒ none; `useSelection` picks the selection bounds;
  foreground remap replaces the resolved ink hex with the chosen color; `scale`
  reaches the rasterizer.
- **VM** (`services/tests/`): an option change recomputes `Preview`;
  `HasSelection=false` forces whole; `ExportCommand` resolves the expected
  `ExportOptions` and closes; `CancelCommand` closes with `undefined`.
- **PNG**: `exportRendered(Png,…)` yields a PNG `Uint8Array` (PNG magic) and calls
  `WriteBytes`.
- **Playwright `_electron`**: `Export…` opens the dialog; changing format + scale
  then `Export` writes the chosen file. (Repo `_electron` convention.)

Every test file lives in a `tests/` subfolder beside its source (repo rule).

## 7. Out of Scope

- Multi-page / paginated export (one image of the content bounds only).
- Per-node recolor or full theme swap (foreground is a scoped ink remap).
- PDF / direct-to-clipboard export.
- Persisting export options across sessions (dialog defaults are fixed for v1).
- Print.
