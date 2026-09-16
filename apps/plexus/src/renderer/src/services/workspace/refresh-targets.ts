import { DiagnosticSeverity, type Diagnostic } from '../diagnostics/diagnostic.js'
import { ProblemSeverity, type GetProblemsResult, type ProblemItem, type RefreshedProjectSummary } from '../../../../shared/agent-api.js'

// The minimum an open project contributes to refresh targeting + summaries.
export interface OpenProjectRef { folder: string; name: string }

const MAX_SAMPLE_MESSAGES = 5
// Cap on problems returned by get_problems, so a huge workspace can't dump
// thousands of items into the agent's context. Counts + total still reflect the
// full filtered set; the payload's `truncated` flag marks when this bit.
const MAX_PROBLEMS = 200

// Normalize a path for containment comparison: backslashes → slashes, drop a
// trailing slash, lowercase (Plexus targets Windows; folder identity is
// case-insensitive there and harmless elsewhere for our own project paths).
function normalize(path: string): string
{
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return slashed.toLowerCase()
}

// The open project whose folder CONTAINS `path` (the folder itself, or a path
// under it at a segment boundary). undefined if none — a sibling whose name is a
// mere string prefix ("/p/proj" vs "/p/project-x") does not match.
export function resolveOwningProject(open: readonly OpenProjectRef[], path: string): OpenProjectRef | undefined
{
    const p = normalize(path)
    return open.find((o) =>
    {
        const f = normalize(o.folder)
        return p === f || p.startsWith(`${f}/`)
    })
}

// Compact per-project problem summary from the flat diagnostics set.
export function summarizeProject(ref: OpenProjectRef, diagnostics: readonly Diagnostic[]): RefreshedProjectSummary
{
    const mine = diagnostics.filter((d) => d.projectId === ref.folder)
    return {
        name: ref.name,
        folder: ref.folder,
        errorCount:   mine.filter((d) => d.severity === DiagnosticSeverity.Error).length,
        warningCount: mine.filter((d) => d.severity === DiagnosticSeverity.Warning).length,
        sampleMessages: mine.slice(0, MAX_SAMPLE_MESSAGES).map((d) => d.message),
    }
}

// The store's numeric severity → the wire enum.
function toWireSeverity(s: DiagnosticSeverity): ProblemSeverity
{
    switch (s)
    {
        case DiagnosticSeverity.Error:   return ProblemSeverity.Error
        case DiagnosticSeverity.Warning: return ProblemSeverity.Warning
        case DiagnosticSeverity.Info:    return ProblemSeverity.Info
        case DiagnosticSeverity.Hint:    return ProblemSeverity.Hint
    }
}

// A minimum-severity threshold expressed as a DiagnosticSeverity rank (the enum
// is ordered worst-first: Error=0 … Hint=3), so "include ≥ this severity" is
// `d.severity <= rank`.
function thresholdRank(s: ProblemSeverity): DiagnosticSeverity
{
    switch (s)
    {
        case ProblemSeverity.Error:   return DiagnosticSeverity.Error
        case ProblemSeverity.Warning: return DiagnosticSeverity.Warning
        case ProblemSeverity.Info:    return DiagnosticSeverity.Info
        case ProblemSeverity.Hint:    return DiagnosticSeverity.Hint
    }
}

function toProblemItem(d: Diagnostic): ProblemItem
{
    const item: ProblemItem = {
        project: d.projectName, folder: d.projectId, uri: d.uri,
        severity: toWireSeverity(d.severity), message: d.message, owner: d.owner,
    }
    if (d.span !== null) { item.line = d.span.startLine; item.column = d.span.startColumn }
    return item
}

// Build the get_problems payload (minus its correlation id) from the flat
// diagnostics set. `path` scopes to the open project containing it (early-returns
// a note when nothing owns it); omitted ⇒ every diagnostic (all projects + library
// problems). `severity` is a minimum threshold. Counts + total reflect the full
// filtered set; the list is capped at MAX_PROBLEMS with `truncated` set.
export function collectProblems(
    diagnostics: readonly Diagnostic[],
    open: readonly OpenProjectRef[],
    path?: string,
    severity?: ProblemSeverity,
): Omit<GetProblemsResult, 'id'>
{
    let scoped = diagnostics
    if (path !== undefined)
    {
        const owner = resolveOwningProject(open, path)
        if (owner === undefined)
        {
            return { problems: [], errorCount: 0, warningCount: 0, total: 0, truncated: false, note: `No open project contains ${path}.` }
        }
        scoped = diagnostics.filter((d) => d.projectId === owner.folder)
    }
    if (severity !== undefined)
    {
        const max = thresholdRank(severity)
        scoped = scoped.filter((d) => d.severity <= max)
    }
    const errorCount = scoped.filter((d) => d.severity === DiagnosticSeverity.Error).length
    const warningCount = scoped.filter((d) => d.severity === DiagnosticSeverity.Warning).length
    const total = scoped.length
    const problems = scoped.slice(0, MAX_PROBLEMS).map(toProblemItem)
    return { problems, errorCount, warningCount, total, truncated: total > problems.length }
}
