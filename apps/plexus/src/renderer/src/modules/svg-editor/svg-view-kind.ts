// Which of the SVG document's two stacked sub-views is showing. Explicit string
// values keep the persisted/debuggable form stable (project rule: real enums,
// never string-literal unions).
export enum SvgViewKind
{
    Visual = 'visual',
    Text = 'text',
}
