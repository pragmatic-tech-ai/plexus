import { Brush, Color, SolidColorBrush, type FontStyle, type FontWeight, type TextAlignment, type TextDecorations } from '@pragmatic-tech-ai/mural/visual-engine'

// A label's text-style overrides in memory (foreground as a live Brush). Shared by
// arch NODE labels (ArchNodeVM's Label* DPs) and arch CONNECTOR labels (a ShapeText),
// so both round-trip through one wire shape instead of duplicating the DP↔JSON mapping.
// Every field is optional — an unset field means "no override" (inherit the default).
export interface LabelStyle
{
    fontFamily?: string
    fontSize?: number
    foreground?: Brush
    fontWeight?: FontWeight
    fontStyle?: FontStyle
    textDecorations?: TextDecorations
    textAlignment?: TextAlignment
}

// Round-trips a LabelStyle to/from the JSON-safe form persisted in a diagram (a node
// record's `labelStyle`, or a connector visual's `label.style`). The enum values
// (weight / style / decorations / alignment) travel as their raw wire form, so a
// guarded cast restores them; the foreground SolidColorBrush travels as a hex string.
export class LabelStyleCodec
{
    // JSON-safe record with only the SET overrides — `undefined` when nothing is set,
    // so an unstyled label serializes to nothing at all (no empty `{}` block).
    public static Serialize(s: LabelStyle): Record<string, unknown> | undefined
    {
        const out: Record<string, unknown> = {}
        if (s.fontFamily !== undefined) out.fontFamily = s.fontFamily
        if (s.fontSize !== undefined) out.fontSize = s.fontSize
        if (s.foreground instanceof SolidColorBrush) out.foreground = s.foreground.Color.ToHex()
        if (s.fontWeight !== undefined) out.fontWeight = s.fontWeight
        if (s.fontStyle !== undefined) out.fontStyle = s.fontStyle
        if (s.textDecorations !== undefined) out.textDecorations = s.textDecorations
        if (s.textAlignment !== undefined) out.textAlignment = s.textAlignment
        return Object.keys(out).length > 0 ? out : undefined
    }

    // Parse a persisted block back into a LabelStyle. Non-object / null input yields an
    // empty style (every override absent), so a malformed block degrades to defaults.
    public static Deserialize(data: unknown): LabelStyle
    {
        const s: LabelStyle = {}
        if (data === null || typeof data !== 'object') return s
        const d = data as Record<string, unknown>
        if (typeof d.fontFamily === 'string') s.fontFamily = d.fontFamily
        if (typeof d.fontSize === 'number') s.fontSize = d.fontSize
        if (typeof d.foreground === 'string') s.foreground = new SolidColorBrush(Color.FromHex(d.foreground))
        if (d.fontWeight !== undefined) s.fontWeight = d.fontWeight as FontWeight
        if (d.fontStyle !== undefined) s.fontStyle = d.fontStyle as FontStyle
        if (d.textDecorations !== undefined) s.textDecorations = d.textDecorations as TextDecorations
        if (d.textAlignment !== undefined) s.textAlignment = d.textAlignment as TextAlignment
        return s
    }
}
