import type * as monaco from 'monaco-editor'

// A generic, host-neutral diagnostics channel for the code editor. A producer
// (e.g. the meta-model validator) sets EditorDiagnostics on a CodeDocument; the
// CodeEditor view maps them to Monaco markers to render squiggles. The editor
// stays ignorant of TODL — it only knows ranges + severities + messages.

// Severity of an editor diagnostic.
export enum EditorSeverity
{
    Error = 'error',
    Warning = 'warning',
    Info = 'info',
    Hint = 'hint',
}

// One diagnostic against a document's text. Positions are 1-based and
// `endColumn` is exclusive (points just past the last offending character) —
// the convention Monaco's IMarkerData and TODL's SourceSpan both use, so
// mapping either direction is a straight copy.
export interface EditorDiagnostic
{
    severity:    EditorSeverity
    message:     string
    startLine:   number
    startColumn: number
    endLine:     number
    endColumn:   number
}

// EditorSeverity → Monaco MarkerSeverity numeric value (Hint 1, Info 2,
// Warning 4, Error 8 — monaco.MarkerSeverity's stable public values, inlined so
// this module needs no Monaco runtime and stays unit-testable under node).
const MONACO_SEVERITY: Record<EditorSeverity, number> = {
    [EditorSeverity.Error]:   8,
    [EditorSeverity.Warning]: 4,
    [EditorSeverity.Info]:    2,
    [EditorSeverity.Hint]:    1,
}

// Map editor diagnostics to Monaco marker data — a pure, testable transform.
export function toMarkers(diags: readonly EditorDiagnostic[]): monaco.editor.IMarkerData[]
{
    return diags.map((d) => ({
        severity:        MONACO_SEVERITY[d.severity] as monaco.MarkerSeverity,
        message:         d.message,
        startLineNumber: d.startLine,
        startColumn:     d.startColumn,
        endLineNumber:   d.endLine,
        endColumn:       d.endColumn,
    }))
}

// A stable, order-independent fingerprint of a diagnostics set. Setting Monaco
// markers forces a decoration re-render (a CPU hotspot when a project rescan
// re-publishes the SAME diagnostics), so the editor compares this signature and
// skips setModelMarkers when nothing actually changed. Order-independent because
// producers may re-emit the same set in a different order.
export function markerSignature(diags: readonly EditorDiagnostic[]): string
{
    return diags
        .map((d) => `${d.severity}:${d.startLine}:${d.startColumn}:${d.endLine}:${d.endColumn}:${d.message}`)
        .sort()
        .join('\n')
}
