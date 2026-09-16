import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'
import { ClipboardService } from '../../../services/clipboard/clipboard-service.js'
import { ViewportService, type IViewportSource } from '../../../services/viewport/viewport-service.js'
import { ProblemsService, ProblemRowKind } from '../problems-service.js'

function diag(over: Partial<Diagnostic>): Diagnostic
{
    return {
        owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
        message: 'm', severity: DiagnosticSeverity.Error,
        span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 }, ...over,
    }
}

function fakeViewport(h0: number, w0 = 1200): IViewportSource & { push(h: number): void; pushWidth(w: number): void }
{
    let h = h0, w = w0
    const cbs = new Set<() => void>()
    const fire = (): void => { for (const cb of cbs) cb() }
    return {
        height: () => h,
        width: () => w,
        subscribe: (cb) => { cbs.add(cb); return () => cbs.delete(cb) },
        push: (nh: number) => { h = nh; fire() },
        pushWidth: (nw: number) => { w = nw; fire() },
    }
}

function env(height = 1000): {
    store: DiagnosticsService; problems: ProblemsService
    clipped: string[]; viewport: IViewportSource & { push(h: number): void; pushWidth(w: number): void }
}
{
    const provider = new ServiceProvider()
    const store = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, store)
    const clipped: string[] = []
    provider.registerInstance(ClipboardService.Key, new ClipboardService(provider, async (t) => { clipped.push(t) }))
    const viewport = fakeViewport(height)
    provider.registerInstance(ViewportService.Key, new ViewportService(provider, viewport))
    const problems = new ProblemsService(provider)
    return { store, problems, clipped, viewport }
}

test('counts errors and warnings across the store', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Warning }),
    ])
    expect(problems.ErrorCount).toBe(1)
    expect(problems.WarningCount).toBe(1)
})

test('single project: no project header, one self-contained row per diagnostic', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 } }),
        diag({ uri: 'b.todl' }),
    ])
    const kinds = [...problems.Rows].map((r) => r.Kind)
    expect(kinds).not.toContain(ProblemRowKind.ProjectHeader)
    expect(kinds).toEqual([ProblemRowKind.Diagnostic, ProblemRowKind.Diagnostic])
    // Each row carries the message AND its file+location in one item.
    const first = [...problems.Rows][0]!
    expect(first.Label).toBe('boom')
    expect(first.Detail).toBe('a.todl 2:3')
})

test('multi-project: a project header per project', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ projectId: '/p', projectName: 'P', uri: 'a.todl' })])
    store.Publish('todl', '/q', [diag({ projectId: '/q', projectName: 'Q', uri: 'a.todl' })])
    const headers = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.ProjectHeader)
    expect(headers.map((h) => h.Label).sort()).toEqual(['P', 'Q'])
})

test('project-level (null-uri) diagnostic renders as a row with an empty location', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [diag({ uri: null, span: null, message: 'Unresolved base: ea@1.' })])
    const diags = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic)
    expect(diags.length).toBe(1)
    expect(diags[0]!.Label).toBe('Unresolved base: ea@1.')
    expect(diags[0]!.Detail).toBe('')
})

test('IsOpen starts closed; Expand() forces the popup open', () => {
    const { problems } = env()
    expect(problems.IsOpen).toBe(false)
    problems.Expand()
    expect(problems.IsOpen).toBe(true)
})

test('a single Publish of many diagnostics rebuilds the rows once, not once per diagnostic', () => {
    // Regression: DiagnosticsService.All fires one collection-change event PER
    // item (Clear + N Adds). Subscribing to that stream made ProblemsService do a
    // full O(N) regroup + non-virtualized row re-materialization on every event —
    // O(N^2), which froze the app on a project with hundreds of diagnostics. The
    // store must signal "changed" once per Publish, so the rows rebuild once.
    const { store, problems } = env()
    const many = Array.from({ length: 50 }, (_, i) => diag({ uri: `f${i}.todl`, message: `m${i}` }))
    // Warm the rows so a subsequent rebuild's rows.Clear() actually fires.
    store.Publish('todl', '/p', many)
    let clears = 0
    problems.Rows.Subscribe((c) => { if (c.kind === 'cleared') clears += 1 })
    // A second publish of the whole set must rebuild the rows exactly once — not
    // once per diagnostic (pre-fix: ~N clears from N+1 store events).
    store.Publish('todl', '/p', many)
    expect(clears).toBe(1)
    expect([...problems.Rows].length).toBe(50)
})

test('SummaryText reflects the counts', () => {
    const { store, problems } = env()
    expect(problems.SummaryText).toBe('No problems')
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', severity: DiagnosticSeverity.Warning }),
    ])
    expect(problems.SummaryText).toBe('1 error, 1 warning')
})

test('ShowErrors=false hides error rows but keeps warnings; counts stay full totals', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'e1', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', message: 'w1', severity: DiagnosticSeverity.Warning }),
    ])
    problems.ShowErrors = false
    const labels = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic).map((r) => r.Label)
    expect(labels).toEqual(['w1'])
    // Counts are unfiltered totals (they label the toggles).
    expect(problems.ErrorCount).toBe(1)
    expect(problems.WarningCount).toBe(1)
})

test('FilterText matches message and file name, case-insensitively', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'alpha.todl', message: 'boom' }),
        diag({ uri: 'beta.todl', message: 'quiet' }),
    ])
    problems.FilterText = 'BOOM'   // matches message
    expect([...problems.Rows].map((r) => r.Label)).toEqual(['boom'])
    problems.FilterText = 'beta'   // matches file name
    expect([...problems.Rows].map((r) => r.Label)).toEqual(['quiet'])
})

test('severity and text filters intersect', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Warning }),
    ])
    problems.FilterText = 'boom'
    problems.ShowWarnings = false
    const rows = [...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic)
    expect(rows.length).toBe(1)   // only the error 'boom' survives both filters
})

test('ListMaxHeight is 30% of the viewport height and tracks resizes', () => {
    const { problems, viewport } = env(1000)
    expect(problems.ListMaxHeight).toBe(300)   // 0.3 * 1000
    viewport.push(800)
    expect(problems.ListMaxHeight).toBe(240)   // 0.3 * 800
})

test('PopupWidth equals the viewport width and tracks resizes', () => {
    const { problems, viewport } = env(1000)
    expect(problems.PopupWidth).toBe(1200)   // fakeViewport default width
    viewport.pushWidth(1600)
    expect(problems.PopupWidth).toBe(1600)
})

test('CopyAllCommand copies the filtered rows as text; a row CopyCommand copies just its line', async () => {
    const { store, problems, clipped } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Error, span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 } }),
        diag({ uri: 'b.todl', message: 'quiet', severity: DiagnosticSeverity.Warning, span: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 2 } }),
    ])
    problems.ShowWarnings = false   // hide the warning; copy-all is WYSIWYG

    problems.CopyAllCommand!.Execute()
    await Promise.resolve()
    expect(clipped.at(-1)).toBe('ERROR  a.todl 2:3  boom')

    const errorRow = [...problems.Rows].find((r) => r.Kind === ProblemRowKind.Diagnostic)!
    errorRow.CopyCommand!.Execute()
    await Promise.resolve()
    expect(clipped.at(-1)).toBe('ERROR  a.todl 2:3  boom')
})

test('ClearFiltersCommand resets text and both severity toggles, restoring all rows', () => {
    const { store, problems } = env()
    store.Publish('todl', '/p', [
        diag({ uri: 'a.todl', message: 'boom', severity: DiagnosticSeverity.Error }),
        diag({ uri: 'a.todl', message: 'quiet', severity: DiagnosticSeverity.Warning }),
    ])
    problems.ShowWarnings = false
    problems.FilterText = 'boom'
    expect([...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic).length).toBe(1)

    problems.ClearFiltersCommand!.Execute()
    expect(problems.FilterText).toBe('')
    expect(problems.ShowErrors).toBe(true)
    expect(problems.ShowWarnings).toBe(true)
    expect([...problems.Rows].filter((r) => r.Kind === ProblemRowKind.Diagnostic).length).toBe(2)
})
