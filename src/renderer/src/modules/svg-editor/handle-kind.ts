// The eight resize handles around a selection box. Explicit string values keep
// the debuggable form stable (project rule: real enums, never string-literal
// unions). The value doubles as the `data-handle` attribute on overlay handles.
export enum HandleKind
{
    N = 'n', S = 's', E = 'e', W = 'w',
    NE = 'ne', NW = 'nw', SE = 'se', SW = 'sw',
}
