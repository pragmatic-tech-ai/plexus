import { SvgDrawingContext, FormattedText, type Point } from '@pragmatic-tech-ai/mural/visual-engine'

// SvgDrawingContext hardened for offscreen export.
//
// The retained (canvas) renderer tolerates a TextBlock whose FontFamily.Source is
// undefined — a label whose font was never explicitly set: the browser's text APIs
// fall back to a default font, so it draws fine on screen. mural's SvgDrawingContext
// does NOT: its DrawText emits `font-family="${escapeXmlAttr(text.FontFamily)}"`, and
// escapeXmlAttr(undefined) throws `Cannot read properties of undefined (reading
// 'replace')`, aborting the whole SVG export the first time such a label is painted.
//
// Normalize an absent/blank family to mural's own default so export matches what the
// live view draws, rather than crashing. This is the text counterpart to
// DiagramSvgRenderer.exportableClip — both harden the export at the drawing-context
// boundary against inputs the live target renders but the SVG target rejects.
export class ExportDrawingContext extends SvgDrawingContext
{
  // Mirrors mural basic/theme.ts DEFAULT_FONT_FAMILY (not re-exported publicly).
  private static readonly DefaultFontFamily = 'system-ui, sans-serif'

  public override DrawText(text: FormattedText, origin: Point): void
  {
    if (text.FontFamily === undefined || text.FontFamily === '')
      text.FontFamily = ExportDrawingContext.DefaultFontFamily
    super.DrawText(text, origin)
  }
}
