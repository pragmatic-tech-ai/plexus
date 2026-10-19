import { describe, it, expect, vi } from 'vitest'

const markerState = vi.hoisted(() => ({ listeners: [] as Array<() => void>, disposed: 0, records: [] as unknown[] }))
vi.mock('../model-registry.js', () => ({
    MonacoModelRegistry: class
    {
        public Ensure(): void {}
        public Has(): boolean { return false }
        public Dispose(): void {}
    },
}))
vi.mock('../marker-source.js', () => ({
    MonacoMarkerSource: class
    {
        public All(): unknown[] { return markerState.records }
        public OnDidChange(listener: () => void): { dispose(): void }
        {
            markerState.listeners.push(listener)
            return { dispose: () => { markerState.disposed++ } }
        }
    },
}))
vi.mock('../typescript-language-host.js', () => ({
    TypeScriptLanguageHost: { Configure: vi.fn() },
}))

import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { TypeScriptDiagnosticsSinkKey } from '@pragmatic-tech-ai/plexus-core/renderer/typescript/typescript-seams.js'
import { TypeScriptModule } from '../typescript-module.js'
import { TypeScriptWorkspace } from '../typescript-workspace.js'
import { MuralDiagnosticsBridge } from '../../code-editor/mural-diagnostics-bridge.js'

describe('TypeScriptModule.Compose with a real ServiceProvider', () =>
{
    it('delivers track/untrack to both bridges and keeps the TS bridge live', () =>
    {
        const provider = new ServiceProvider()
        const published: Array<{ owner: string; projectId: string; count: number }> = []
        const cleared: string[] = []
        provider.registerInstance(DiagnosticsService.Key, {
            Publish: (owner: string, projectId: string, d: readonly unknown[]) => published.push({ owner, projectId, count: d.length }),
            ClearProject: (projectId: string) => cleared.push(projectId),
        } as never)
        TypeScriptModule.Compose(provider as never, provider as never)

        const sink = provider.getRequired(TypeScriptDiagnosticsSinkKey)
        const mural = provider.getRequired(MuralDiagnosticsBridge.Key)
        const tracked = vi.spyOn(mural, 'TrackProject')
        const untracked = vi.spyOn(mural, 'UntrackProject')

        sink.TrackProject('/p', 'P')
        expect(tracked).toHaveBeenCalledWith('/p', 'P')
        // TS bridge Republish on track publishes its (empty) slice.
        expect(published.some(p => p.owner === 'typescript' && p.projectId === '/p')).toBe(true)

        // Resolving again must not evict/dispose anything; TS bridge subscription stays live.
        provider.getRequired(TypeScriptDiagnosticsSinkKey)
        expect(markerState.disposed).toBe(0)
        const before = published.length
        for (const l of markerState.listeners) l()
        expect(published.length).toBeGreaterThan(before)
        expect(published.slice(before).every(p => p.owner === 'typescript')).toBe(true)

        sink.UntrackProject('/p')
        expect(untracked).toHaveBeenCalledWith('/p')
        expect(cleared.filter(id => id === '/p').length).toBeGreaterThanOrEqual(2)
        expect(TypeScriptWorkspace.PrefixFor('/p').length).toBeGreaterThan(0)
    })
})
