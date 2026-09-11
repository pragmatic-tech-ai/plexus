import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { WorkspaceRefreshService } from '../workspace-refresh-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { DiagnosticsService } from '../../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../diagnostics/diagnostic.js'
import { AgentEventKind, type AgentEvent, type GetProblemsResult, type RefreshProjectResult, type TaggedAgentEvent } from '../../../../../shared/agent-api.js'

// Minimal fakes. onEvent captures the handler so the test can push events; the
// bridge records the results the service sends back. A fake ProjectExplorerService
// exposes two open projects and records the folders passed to RefreshProjects.
function harness(): {
    provider: ServiceProvider
    results: RefreshProjectResult[]
    problems: GetProblemsResult[]
    diagnostics: DiagnosticsService
    refreshedWith: string[][]
    push: (e: AgentEvent) => void
}
{
    let handler: ((m: TaggedAgentEvent) => void) | undefined
    const results: RefreshProjectResult[] = []
    const problems: GetProblemsResult[] = []
    const refreshedWith: string[][] = []

    ;(globalThis as unknown as { api: unknown }).api = {
        agent: {
            onEvent: (h: (m: TaggedAgentEvent) => void) => { handler = h; return () => { handler = undefined } },
            refreshProjectResult: (r: RefreshProjectResult) => { results.push(r); return Promise.resolve() },
            getProblemsResult: (r: GetProblemsResult) => { problems.push(r); return Promise.resolve() },
        },
    }

    const provider = new ServiceProvider()
    provider.registerInstance(ProjectExplorerService.Key, {
        OpenProjects: { ToArray: () => [
            { Folder: '/p/a', Name: 'A' },
            { Folder: '/p/b', Name: 'B' },
        ] },
        RefreshProjects: async (folders: readonly string[]) => { refreshedWith.push([...folders]) },
    } as unknown as ProjectExplorerService)

    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    diagnostics.Publish('todl', '/p/a', [
        { owner: 'todl', projectId: '/p/a', projectName: 'A', uri: 'x.todl', message: 'boom', severity: DiagnosticSeverity.Error, span: null },
    ])

    return { provider, results, problems, diagnostics, refreshedWith, push: (e) => handler?.({ SessionId: '', Event: e }) }
}

// Let the async event handler settle (it awaits RefreshProjects).
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('WorkspaceRefreshService', () => {
    beforeEach(() => { delete (globalThis as unknown as { api?: unknown }).api })
    afterEach(() => { delete (globalThis as unknown as { api?: unknown }).api })

    test('no path → refreshes all open projects and returns a summary each', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r1' } })
        await settle()
        expect(h.refreshedWith[0]).toEqual(['/p/a', '/p/b'])
        const result = h.results[0]!
        expect(result.id).toBe('r1')
        expect(result.projects.length).toBe(2)
        expect(result.projects.find((p) => p.folder === '/p/a')?.errorCount).toBe(1)
        service.dispose()
    })

    test('path inside project A → refreshes only A', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r2', path: '/p/a/models/x.todl' } })
        await settle()
        expect(h.refreshedWith[0]).toEqual(['/p/a'])
        expect(h.results[0]!.projects.length).toBe(1)
        service.dispose()
    })

    test('path matching nothing → empty projects with a note', async () => {
        const h = harness()
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.RefreshProject, Request: { id: 'r3', path: '/nope/x.todl' } })
        await settle()
        expect(h.refreshedWith[0]).toEqual([])
        expect(h.results[0]!.projects.length).toBe(0)
        expect((h.results[0]!.note ?? '').length).toBeGreaterThan(0)
        service.dispose()
    })

    test('GetProblems → reads diagnostics and replies with the problems list (read-only, no refresh)', () => {
        const h = harness()
        h.diagnostics.Publish('todl', '/p/b', [
            { owner: 'todl', projectId: '/p/b', projectName: 'B', uri: 'y.todl', message: 'warn', severity: DiagnosticSeverity.Warning, span: null },
        ])
        const service = new WorkspaceRefreshService(h.provider)
        h.push({ Kind: AgentEventKind.GetProblems, Request: { id: 'p1' } })
        // Synchronous handler — no project re-scan happens.
        expect(h.refreshedWith.length).toBe(0)
        const res = h.problems[0]!
        expect(res.id).toBe('p1')
        expect(res.total).toBe(2)
        expect(res.errorCount).toBe(1)
        expect(res.warningCount).toBe(1)
        service.dispose()
    })
})
