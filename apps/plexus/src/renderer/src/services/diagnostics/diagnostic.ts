import { EditorSeverity, type EditorDiagnostic } from '../../modules/code-editor/editor-diagnostic.js'

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

const EDITOR_SEVERITY: Record<DiagnosticSeverity, EditorSeverity> = {
    [DiagnosticSeverity.Error]:   EditorSeverity.Error,
    [DiagnosticSeverity.Warning]: EditorSeverity.Warning,
    [DiagnosticSeverity.Info]:    EditorSeverity.Info,
    [DiagnosticSeverity.Hint]:    EditorSeverity.Hint,
}

// Project the canonical diagnostic down to the editor's host-neutral shape. A
// null span (a project-level diagnostic) collapses to the document start, the
// same convention the validator already used for unattributed diagnostics.
export function toEditorDiagnostic(d: Diagnostic): EditorDiagnostic
{
    const span = d.span ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }
    return {
        severity:    EDITOR_SEVERITY[d.severity],
        message:     d.message,
        startLine:   span.startLine,
        startColumn: span.startColumn,
        endLine:     span.endLine,
        endColumn:   span.endColumn,
    }
}
