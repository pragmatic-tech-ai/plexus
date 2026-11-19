import type { ValueConverter } from '@pragmatic-tech-ai/mural/runtime'

// Formats a camera zoom factor (1 = 100%) as a whole-number percentage for the
// zoom toolbar readout. Nullish (no live view yet) renders as blank. Used in
// markup as `$Zoom << ZoomPercent`.
export const ZoomPercent: ValueConverter = {
    convert: (zoom: unknown) =>
        typeof zoom === 'number' ? `${Math.round(zoom * 100)}%` : '',
}
