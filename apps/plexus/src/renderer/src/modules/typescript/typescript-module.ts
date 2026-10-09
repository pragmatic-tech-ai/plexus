import type { IServiceContainer, IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { TypeScriptWorkspaceSinkKey, TypeScriptDiagnosticsSinkKey } from '@pragmatic-tech-ai/plexus-core/renderer/typescript/typescript-seams.js'
import { CodeDocument } from '../code-editor/code-document.js'
import { TypeScriptLanguageHost } from './typescript-language-host.js'
import { TypeScriptWorkspace } from './typescript-workspace.js'
import { MonacoModelRegistry } from './model-registry.js'
import { TypeScriptDiagnosticsBridge } from './typescript-diagnostics-bridge.js'
import { MonacoMarkerSource } from './marker-source.js'

// Bootstrap for TypeScript editing: configures the Monaco TS worker, registers the per-project
// workspace + diagnostics bridge under both their concrete keys and the plexus-core sink seams,
// and re-ensures a closed .ts/.tsx file's model (the CodeEditor disposes the URI-keyed model it
// adopted on close, which would otherwise drop the file from the TS worker's program).
export class TypeScriptModule
{
    private static readonly RemovedKind = 'removed'
    private static readonly TypeScriptExtensions: readonly string[] = ['.ts', '.tsx']

    public static Compose(container: IServiceContainer, provider: IServiceProvider): void
    {
        TypeScriptLanguageHost.Configure()

        const workspace = new TypeScriptWorkspace(new MonacoModelRegistry())
        container.registerInstance(TypeScriptWorkspace.Key, workspace)
        container.registerInstance(TypeScriptWorkspaceSinkKey, workspace)

        const bridge = new TypeScriptDiagnosticsBridge(new MonacoMarkerSource(), provider.getRequired(DiagnosticsService.Key))
        container.registerInstance(TypeScriptDiagnosticsBridge.Key, bridge)
        container.registerInstance(TypeScriptDiagnosticsSinkKey, bridge)

        TypeScriptModule.SubscribeClose(workspace, provider)
    }

    private static SubscribeClose(workspace: TypeScriptWorkspace, provider: IServiceProvider): void
    {
        const host = provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe((change) =>
        {
            if (change.kind !== TypeScriptModule.RemovedKind) return
            for (const doc of change.items) TypeScriptModule.ReEnsure(workspace, doc as CodeDocument)
        })
    }

    private static ReEnsure(workspace: TypeScriptWorkspace, doc: CodeDocument): void
    {
        const id = doc?.Id
        if (typeof id !== 'string') return
        const lower = id.toLowerCase()
        if (!TypeScriptModule.TypeScriptExtensions.some(ext => lower.endsWith(ext))) return
        if (!doc.Uri) return
        const parsed = TypeScriptWorkspace.RelPathFromUri(doc.Uri)
        if (parsed === undefined) return
        const projectId = workspace.ProjectIdForKey(parsed.projectKey)
        if (projectId === undefined) return
        void workspace.EnsureModelFor(projectId, parsed.relPath)
    }
}
