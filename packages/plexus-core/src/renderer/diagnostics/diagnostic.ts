// The canonical, source-agnostic diagnostic. Producers (e.g. the TODL validator)
// publish these to the DiagnosticsService; the Problems dock and the editor
// consume them. Richer than EditorDiagnostic: it carries which project and file
// (or none, for a project-level problem like an unresolved base binding) and
// which producer emitted it ("owner"), so the store can replace a producer's
// slice atomically.
export enum DiagnosticSeverity { Error, Warning, Info, Hint }

// 1-based line/column; endColumn is exclusive (Monaco + TODL convention).
export interface DiagnosticSpan
{
    startLine:   number
    startColumn: number
    endLine:     number
    endColumn:   number
}

export interface Diagnostic
{
    owner:       string                 // producer id, e.g. "todl"
    projectId:   string                 // Project.RootPath — the open project's identity
    projectName: string                 // Project.Name — for the dock's group header
    uri:         string | null          // project-relative file; null ⇒ project-level
    message:     string
    severity:    DiagnosticSeverity
    span:        DiagnosticSpan | null   // null for project-level diagnostics
    code?:       string                 // reserved rule id (unused in v1)
}
