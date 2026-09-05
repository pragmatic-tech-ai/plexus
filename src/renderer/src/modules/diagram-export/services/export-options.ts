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
