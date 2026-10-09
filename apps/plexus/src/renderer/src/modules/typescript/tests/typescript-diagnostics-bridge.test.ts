import { describe, it, expect } from 'vitest'
import { DiagnosticSeverity } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import { TypeScriptWorkspace } from '../typescript-workspace.js'
import { TypeScriptDiagnosticsBridge } from '../typescript-diagnostics-bridge.js'
import type { IMarkerSource, MarkerRecord } from '../marker-source.js'

class FakeMarkerSource implements IMarkerSource
{
    private listener: (() => void) | undefined
    public markers: MarkerRecord[] = []
    public OnDidChange(l: () => void) { this.listener = l; return { dispose: () => { this.listener = undefined } } }
    public All() { return this.markers }
    public Fire() { this.listener?.() }
}

class FakeDiagnostics
{
    public published = new Map<string, unknown[]>()
    public cleared: string[] = []
    public Publish(owner: string, projectId: string, diags: readonly unknown[]) { this.published.set(`${owner} ${projectId}`, [...diags]) }
    public ClearProject(projectId: string) { this.cleared.push(projectId) }
}

const A = 'C:\\a'
const B = 'C:\\b'

describe('TypeScriptDiagnosticsBridge', () =>
{
    it('publishes only a project\'s own markers under owner "typescript"', () =>
    {
        const src = new FakeMarkerSource()
        const diag = new FakeDiagnostics()
        const bridge = new TypeScriptDiagnosticsBridge(src, diag as never)
        bridge.TrackProject(A, 'a')
        bridge.TrackProject(B, 'b')
        src.markers = [
            { Uri: TypeScriptWorkspace.ModelUriFor(A, 'src/main.ts'), Severity: 8, Message: 'oops', StartLine: 1, StartColumn: 1, EndLine: 1, EndColumn: 2 },
            { Uri: TypeScriptWorkspace.ModelUriFor(B, 'src/main.ts'), Severity: 4, Message: 'warn', StartLine: 2, StartColumn: 1, EndLine: 2, EndColumn: 3 },
        ]
        src.Fire()
        const aSlice = diag.published.get('typescript ' + A) as any[]
        expect(aSlice).toHaveLength(1)
        expect(aSlice[0].uri).toBe('src/main.ts')
        expect(aSlice[0].severity).toBe(DiagnosticSeverity.Error)
        const bSlice = diag.published.get('typescript ' + B) as any[]
        expect(bSlice).toHaveLength(1)
        expect(bSlice[0].severity).toBe(DiagnosticSeverity.Warning)
    })

    it('UntrackProject clears the project slice', () =>
    {
        const diag = new FakeDiagnostics()
        const bridge = new TypeScriptDiagnosticsBridge(new FakeMarkerSource(), diag as never)
        bridge.TrackProject(A, 'a')
        bridge.UntrackProject(A)
        expect(diag.cleared).toContain(A)
    })
})
