import { ServiceKey, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import { compile, ParseError, EmitError, type SourceSpan } from '@pragmatic-tech-ai/mural/compiler'
import { DiagnosticSeverity, type Diagnostic, type DiagnosticSpan } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import type { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import type { ITypeScriptDiagnosticsSink } from '@pragmatic-tech-ai/plexus-core/renderer/typescript/typescript-seams.js'
import { TypeScriptWorkspace } from '../typescript/typescript-workspace.js'

// Compiles .mu (Mural markup) documents and republishes the compiler's first error
// into the shared DiagnosticsService (owner "mural"), so Mural errors show in the
// Problems dock instead of only at build time. The compiler throws on the first
// error, so each document contributes at most one diagnostic; a clean compile
// publishes that project's remaining slice (empty when nothing else is failing),
// clearing the previous one. Mural's SourceLocation is already 1-based (line and
// column) with an exclusive end, matching DiagnosticSpan.
export class MuralDiagnosticsBridge implements ITypeScriptDiagnosticsSink
{
    public static readonly Key = new ServiceKey<MuralDiagnosticsBridge>('MuralDiagnosticsBridge')

    private static readonly Owner = 'mural'
    private static readonly FallbackMessage = 'Mural compile failed'

    private readonly tracked = new Map<string, { projectName: string; prefix: string }>()
    // Per project: the diagnostic for each document uri that currently has one.
    private readonly slices = new Map<string, Map<string, Diagnostic>>()

    // Latest text of open models whose project was not tracked when last checked; rechecked on TrackProject.
    private readonly pending = new Map<string, string>()

    public constructor(private readonly diagnostics: DiagnosticsService)
    {
    }

    public TrackProject(projectId: string, projectName: string): void
    {
        this.tracked.set(projectId, { projectName, prefix: TypeScriptWorkspace.PrefixFor(projectId) })
        const prefix = TypeScriptWorkspace.PrefixFor(projectId)
        for (const [modelUri, text] of [...this.pending])
        {
            if (!modelUri.startsWith(prefix)) continue
            this.pending.delete(modelUri)
            this.CheckModel(modelUri, text)
        }
    }

    // Drops the remembered text of a closed model.
    public ForgetModel(modelUri: string): void
    {
        this.pending.delete(modelUri)
    }

    public UntrackProject(projectId: string): void
    {
        this.tracked.delete(projectId)
        this.slices.delete(projectId)
        this.diagnostics.ClearProject(projectId)
    }

    // Resolves the owning tracked project from a Monaco model uri; undefined if none.
    public ProjectIdForModelUri(modelUri: string): string | undefined
    {
        for (const [projectId, info] of this.tracked)
        {
            if (modelUri.startsWith(info.prefix)) return projectId
        }
        return undefined
    }

    // Compile one .mu document and publish the project's mural slice.
    public CheckDocument(projectId: string, projectName: string, uri: string, text: string): void
    {
        let slice = this.slices.get(projectId)
        if (slice === undefined)
        {
            slice = new Map<string, Diagnostic>()
            this.slices.set(projectId, slice)
        }
        const diagnostic = MuralDiagnosticsBridge.Compile(projectId, projectName, uri, text)
        if (diagnostic === undefined) slice.delete(uri)
        else slice.set(uri, diagnostic)
        this.diagnostics.Publish(MuralDiagnosticsBridge.Owner, projectId, [...slice.values()])
    }

    // Model-uri entry point used by the editor wiring.
    public CheckModel(modelUri: string, text: string): void
    {
        const projectId = this.ProjectIdForModelUri(modelUri)
        if (projectId === undefined)
        {
            this.pending.set(modelUri, text)
            return
        }
        const parsed = TypeScriptWorkspace.RelPathFromUri(modelUri)
        if (parsed === undefined) return
        const info = this.tracked.get(projectId)
        if (info === undefined) return
        this.CheckDocument(projectId, info.projectName, parsed.relPath, text)
    }

    private static Compile(projectId: string, projectName: string, uri: string, text: string): Diagnostic | undefined
    {
        try
        {
            compile(text)
            return undefined
        }
        catch (error)
        {
            if (!(error instanceof ParseError) && !(error instanceof EmitError)) throw error
            return {
                owner: MuralDiagnosticsBridge.Owner,
                projectId,
                projectName,
                uri,
                message: error.message || MuralDiagnosticsBridge.FallbackMessage,
                severity: DiagnosticSeverity.Error,
                span: error.span === undefined ? null : MuralDiagnosticsBridge.ToSpan(error.span),
            }
        }
    }

    private static ToSpan(span: SourceSpan): DiagnosticSpan
    {
        return {
            startLine: span.start.line,
            startColumn: span.start.column,
            endLine: span.end.line,
            endColumn: span.end.column,
        }
    }
}

// Fans the project track/untrack signals out to several sinks (the TS bridge and
// the mural bridge both listen on TypeScriptDiagnosticsSinkKey).
export class DiagnosticsSinkFanout implements ITypeScriptDiagnosticsSink
{
    public constructor(private readonly sinks: readonly ITypeScriptDiagnosticsSink[])
    {
    }

    public TrackProject(projectId: string, projectName: string): void
    {
        for (const sink of this.sinks) sink.TrackProject(projectId, projectName)
    }

    public UntrackProject(projectId: string): void
    {
        for (const sink of this.sinks) sink.UntrackProject(projectId)
    }

    // Provider teardown: forward to the owned sinks that are disposable.
    public dispose(): void
    {
        for (const sink of this.sinks) (sink as Partial<IDisposable>).dispose?.()
    }
}
