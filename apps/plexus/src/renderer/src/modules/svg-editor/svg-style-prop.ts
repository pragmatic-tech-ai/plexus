// Which paint property a Format Shape edit touches. Explicit string values keep
// the debuggable form stable (project rule: real enums, never string-literal
// unions). Stroke width lives inside the Pen, so it rides on Stroke.
export enum SvgStyleProp
{
    Fill = 'fill',
    Stroke = 'stroke',
}
