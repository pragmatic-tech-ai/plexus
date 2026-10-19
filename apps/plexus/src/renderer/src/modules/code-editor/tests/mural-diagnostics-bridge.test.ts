import { describe, it, expect } from 'vitest'
import { DiagnosticSeverity, type Diagnostic } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import type { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { TypeScriptWorkspace } from '../../typescript/typescript-workspace.js'
import { MuralDiagnosticsBridge } from '../mural-diagnostics-bridge.js'

class SpyDiagnostics
{
    public readonly Published: Array<{ owner: string; projectId: string; diagnostics: readonly Diagnostic[] }> = []
    public readonly Cleared: string[] = []

    public Publish(owner: string, projectId: string, diagnostics: readonly Diagnostic[]): void
    {
        this.Published.push({ owner, projectId, diagnostics })
    }

    public ClearProject(projectId: string): void
    {
        this.Cleared.push(projectId)
    }
}

describe('MuralDiagnosticsBridge', () =>
{
    const BadSource = 'Border {'
    const GoodSource = 'Border { }'

    it('publishes one 1-based Error diagnostic for a syntax error', () =>
    {
        const spy = new SpyDiagnostics()
        const bridge = new MuralDiagnosticsBridge(spy as unknown as DiagnosticsService)
        bridge.CheckDocument('p1', 'Proj', 'views/a.mu', BadSource)
        const last = spy.Published[spy.Published.length - 1]
        expect(last.owner).toBe('mural')
        expect(last.projectId).toBe('p1')
        expect(last.diagnostics).toHaveLength(1)
        const d = last.diagnostics[0]
        expect(d.severity).toBe(DiagnosticSeverity.Error)
        expect(d.owner).toBe('mural')
        expect(d.uri).toBe('views/a.mu')
        expect(d.message.length).toBeGreaterThan(0)
        expect(d.span).not.toBeNull()
        expect(d.span).toEqual({ startLine: 1, startColumn: 9, endLine: 1, endColumn: 9 })
    })

    it('publishes an empty slice for a valid source (clears prior errors)', () =>
    {
        const spy = new SpyDiagnostics()
        const bridge = new MuralDiagnosticsBridge(spy as unknown as DiagnosticsService)
        bridge.CheckDocument('p1', 'Proj', 'views/a.mu', BadSource)
        bridge.CheckDocument('p1', 'Proj', 'views/a.mu', GoodSource)
        expect(spy.Published[spy.Published.length - 1].diagnostics).toEqual([])
    })

    it('UntrackProject clears the project', () =>
    {
        const spy = new SpyDiagnostics()
        const bridge = new MuralDiagnosticsBridge(spy as unknown as DiagnosticsService)
        bridge.TrackProject('p1', 'Proj')
        bridge.UntrackProject('p1')
        expect(spy.Cleared).toEqual(['p1'])
    })

    it('rechecks an already-open model when its project is tracked later', () =>
    {
        const spy = new SpyDiagnostics()
        const bridge = new MuralDiagnosticsBridge(spy as unknown as DiagnosticsService)
        const uri = TypeScriptWorkspace.ModelUriFor('p1', 'views/a.mu')
        bridge.CheckModel(uri, BadSource)
        expect(spy.Published).toHaveLength(0)
        bridge.TrackProject('p1', 'Proj')
        const last = spy.Published[spy.Published.length - 1]
        expect(last.projectId).toBe('p1')
        expect(last.diagnostics).toHaveLength(1)
    })

    it('does not recheck a forgotten model on track', () =>
    {
        const spy = new SpyDiagnostics()
        const bridge = new MuralDiagnosticsBridge(spy as unknown as DiagnosticsService)
        const uri = TypeScriptWorkspace.ModelUriFor('p1', 'views/a.mu')
        bridge.CheckModel(uri, BadSource)
        bridge.ForgetModel(uri)
        bridge.TrackProject('p1', 'Proj')
        expect(spy.Published).toHaveLength(0)
    })
})
