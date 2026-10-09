import { ServiceKey, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticSeverity, type Diagnostic } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import type { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import type { ITypeScriptDiagnosticsSink } from '@pragmatic-tech-ai/plexus-core/renderer/typescript/typescript-seams.js'
import { TypeScriptWorkspace } from './typescript-workspace.js'
import type { IMarkerSource, MarkerRecord } from './marker-source.js'

// Republishes Monaco's TypeScript markers into the shared DiagnosticsService, per
// tracked project, so TS errors appear in the Problems dock beside model/mural ones.
// Owner "typescript"; each change re-publishes a project's whole slice (Publish
// replaces it atomically), filtered strictly to that project's URI prefix.
export class TypeScriptDiagnosticsBridge implements ITypeScriptDiagnosticsSink
{
    public static readonly Key = new ServiceKey<TypeScriptDiagnosticsBridge>('TypeScriptDiagnosticsBridge')

    private static readonly Owner = 'typescript'
    // Monaco MarkerSeverity: Hint=1, Info=2, Warning=4, Error=8.
    private static readonly SeverityError = 8
    private static readonly SeverityWarning = 4
    private static readonly SeverityInfo = 2

    private readonly tracked = new Map<string, { projectName: string; prefix: string }>()
    private readonly sub: IDisposable

    constructor(private readonly markers: IMarkerSource, private readonly diagnostics: DiagnosticsService)
    {
        this.sub = this.markers.OnDidChange(() => this.Republish())
    }

    public TrackProject(projectId: string, projectName: string): void
    {
        this.tracked.set(projectId, { projectName, prefix: TypeScriptWorkspace.PrefixFor(projectId) })
        this.Republish()
    }

    public UntrackProject(projectId: string): void
    {
        this.tracked.delete(projectId)
        this.diagnostics.ClearProject(projectId)
    }

    public dispose(): void
    {
        this.sub.dispose()
        this.tracked.clear()
    }

    private Republish(): void
    {
        const all = this.markers.All()
        for (const [projectId, info] of this.tracked)
        {
            const slice: Diagnostic[] = []
            for (const marker of all)
            {
                if (!marker.Uri.startsWith(info.prefix)) continue
                const parsed = TypeScriptWorkspace.RelPathFromUri(marker.Uri)
                if (parsed === undefined) continue
                slice.push(TypeScriptDiagnosticsBridge.ToDiagnostic(marker, projectId, info.projectName, parsed.relPath))
            }
            this.diagnostics.Publish(TypeScriptDiagnosticsBridge.Owner, projectId, slice)
        }
    }

    private static ToDiagnostic(marker: MarkerRecord, projectId: string, projectName: string, relPath: string): Diagnostic
    {
        return {
            owner: TypeScriptDiagnosticsBridge.Owner,
            projectId,
            projectName,
            uri: relPath,
            message: marker.Message,
            severity: TypeScriptDiagnosticsBridge.MapSeverity(marker.Severity),
            span: { startLine: marker.StartLine, startColumn: marker.StartColumn, endLine: marker.EndLine, endColumn: marker.EndColumn },
        }
    }

    private static MapSeverity(monacoSeverity: number): DiagnosticSeverity
    {
        if (monacoSeverity === TypeScriptDiagnosticsBridge.SeverityError) return DiagnosticSeverity.Error
        if (monacoSeverity === TypeScriptDiagnosticsBridge.SeverityWarning) return DiagnosticSeverity.Warning
        if (monacoSeverity === TypeScriptDiagnosticsBridge.SeverityInfo) return DiagnosticSeverity.Info
        return DiagnosticSeverity.Hint
    }
}
