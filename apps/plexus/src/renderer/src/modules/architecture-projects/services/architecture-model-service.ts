import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ModelDraft, checkAgainst, parse, type SourceFile } from '@pragmatic-tech-ai/todl'

import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import { collectTodlSources } from '../../../services/todl/todl-sources.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchModel } from './arch-model.js'
import { FileWatchService } from '../../../services/file-watch/file-watch-service.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { normalizePath } from '../../../services/file-watch/path-utils.js'
import { type FileChangeEvent } from '../../../../../shared/file-watch-api.js'

// Debounce for the .todl-change → model-reload path (collapses a save burst).
const RELOAD_DEBOUNCE_MS = 250

// App-scoped: one live ArchModel per open architecture project, keyed by the
// project's stable RootPath. Built lazily from the project's resolved bases
// (meta-model + libraries) plus every .todl file in its storage, composed via
// ModelDraft.fromSources. Dropped when the project closes (Task 4 wires that).
export class ArchitectureModelService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchitectureModelService>('ArchitectureModelService')

    private readonly models = new Map<string, ArchModel>()
    // Per-project debounce timers for the .todl-change → reload path.
    private readonly reloadPending = new Map<string, ReturnType<typeof setTimeout>>()

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        // Drop a project's model when it leaves the open set. Subscribe is a
        // generic change callback, so diff the live RootPaths against the cache
        // (mirrors WorkspaceBaseResolver's OpenProjects.Subscribe pattern).
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        explorer?.OpenProjects.Subscribe(() => {
            const live = new Set(explorer.OpenProjects.ToArray().map((op) => op.Project.RootPath))
            for (const key of [...this.models.keys()])
                if (!live.has(key)) this.close(key)
        })
        // Refresh a cached model when its project's .todl files change on disk
        // (external edit, or the in-app TODL editor saving). Without this the model
        // is a stale snapshot: a diagram re-projects deleted/edited entities from it
        // and only a project-close or app-restart clears it. Debounced per project.
        this.Provider.get(FileWatchService.Key)?.Subscribe((e) => this.onTodlChange(e))
    }

    // A watched file changed — if it is a .todl under a cached model's project
    // root, schedule a debounced reload of that model from disk.
    private onTodlChange(e: FileChangeEvent): void
    {
        if (!e.path.toLowerCase().endsWith('.todl')) return
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        const target = normalizePath(e.path, ci)
        for (const [rootPath, model] of this.models) {
            const root = normalizePath(rootPath, ci)
            if (target === root || target.startsWith(root + '/')) {
                const existing = this.reloadPending.get(rootPath)
                if (existing !== undefined) clearTimeout(existing)
                this.reloadPending.set(rootPath, setTimeout(() => {
                    this.reloadPending.delete(rootPath)
                    void this.reloadModel(rootPath, model)
                }, RELOAD_DEBOUNCE_MS))
                return
            }
        }
    }

    // Re-read the project's .todl sources and rebuild the cached model's draft, so
    // open diagrams re-project against the current source of truth. A parse error
    // in the edited source leaves the previous model in place (the language client
    // surfaces the diagnostic; the diagram keeps rendering).
    private async reloadModel(rootPath: string, model: ArchModel): Promise<void>
    {
        if (this.models.get(rootPath) !== model) return   // closed / replaced meanwhile
        try {
            const sources = await collectTodlSources(model.Storage)
            model.reloadFromDisk(sources)
        } catch { /* keep the last good model; diagnostics come from the LSP */ }
    }

    // Lazy build + cache. Idempotent: a second call returns the cached model.
    public async modelFor(op: OpenProject): Promise<ArchModel>
    {
        const key = op.Project.RootPath
        const cached = this.models.get(key)
        if (cached !== undefined) return cached

        const resolver = this.Provider.getRequired(WorkspaceBaseResolver.Key)
        const { bases, originOf } = await resolver.ResolveForStorage(op.Storage)
        const sources = await collectTodlSources(op.Storage)
        const namespace = deriveNamespace(sources, op.Project.Name)
        // Published bases are OWN-ONLY documents: each carries only its own
        // compiled content and dangles at cross-references into sibling bases and
        // the prelude (a library class -> a meta-model concept -> the prelude
        // `Element`). Wrapping each in its own Repository throws ("edge target ...
        // does not exist"); they only form a closed graph once merged together
        // with the prelude. checkAgainst with no sources does exactly that merge,
        // yielding a single self-contained base Repository to compose against.
        const merged = checkAgainst(bases, []).model
        const draft = ModelDraft.fromSources([merged], sources, { namespace })

        const model = new ArchModel(draft, op.Storage, namespace, merged, originOf ?? new Map())
        this.models.set(key, model)
        return model
    }

    public peek(rootPath: string): ArchModel | undefined
    {
        return this.models.get(rootPath)
    }

    public close(rootPath: string): void
    {
        this.models.delete(rootPath)
    }
}

// The project's model namespace is the namespace the first .todl file declares;
// with no sources, fall back to the project name.
function deriveNamespace(sources: readonly SourceFile[], fallback: string): string
{
    const first = sources[0]
    if (first === undefined) return fallback
    return parse(first.text, first.uri).namespace.path || fallback
}
