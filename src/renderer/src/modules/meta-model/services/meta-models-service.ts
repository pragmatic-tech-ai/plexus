// meta-models-service.ts — the Meta-model module's left-panel content service.
// Module-local: registered by the module's `.services:` block and named by its
// Capability's `ServiceKey`. It renders published meta-models as a virtualized
// tree (model id → version → ontology entities), so it owns its own data shape
// (a MetaModelTreeNode forest) and its own `DataTemplate [DataType =
// MetaModelsService]` (meta-model.resources.mu).
//
// It reads the shared meta-models storage backend (where MetaModelProjectFactory
// publishes under `<id>/<modelVersion>/`) and re-scans every time the panel
// becomes active (IActivatable). Version nodes load their entities lazily on
// first expand (see MetaModelTreeNode / meta-model-tree-builder).
import {
    MetaData,
    MuralBase,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, type IActivatable } from '@pragmatic-tech-ai/mural/framework'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { discoverLibraries, type LoadedLibrary } from '../../library/services/library-loader.js'
import { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'
import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { buildCatalog, type DeleteTarget } from './meta-model-tree-builder.js'
import { MetaModelNodeKind, type MetaModelTreeNode } from './meta-model-tree-node.js'
import { WikiService } from '../../../services/wiki/wiki-service.js'

export class MetaModelsService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<MetaModelsService>('MetaModelsService')

    public static readonly NodesKey = MuralBase.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelsService, 'Nodes',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // True when nothing has been published yet — drives the empty-state text.
    public static readonly IsEmptyKey = MuralBase.RegisterProperty<boolean>(
        MetaModelsService, 'IsEmpty', false, MetaData.None)

    // Bumped each reload; a slower earlier scan whose seq is stale is discarded,
    // so overlapping OnActivated/ctor reloads can't clobber the newest result.
    private reloadSeq = 0
    private readonly changedListeners = new Set<() => void>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(MetaModelsService.NodesKey, new ObservableCollection<MetaModelTreeNode>())
        void this.reload()
    }

    // Fires after every completed reload() (publish / delete). The toolbox's
    // ModelToolboxPages subscribe to self-reconcile instead of a global rebuild.
    public onMetaModelsChanged(cb: () => void): () => void
    {
        this.changedListeners.add(cb)
        return () => { this.changedListeners.delete(cb) }
    }

    private fireMetaModelsChanged(): void { for (const l of [...this.changedListeners]) l() }

    public get Nodes(): ObservableCollection<MetaModelTreeNode>
    {
        return this.get_property_value(MetaModelsService.NodesKey)
    }

    public get IsEmpty(): boolean { return this.get_property_value(MetaModelsService.IsEmptyKey) }

    // IActivatable: re-scan whenever this panel becomes the active capability.
    public OnActivated(): void { void this.reload() }

    // Re-read the backend and rebuild the node tree in place (the bound
    // ObservableCollection updates the panel reactively). Triggers a presentation
    // discover() so a just-published meta-model's visuals become available.
    public async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const backend = ensureMetaModelsBackend(this.Provider)
        const built = await buildCatalog(
            backend,
            () => {},
            (t) => { void this.deleteTarget(t) },
            (nodes) => this.markWiki(nodes),
        )
        if (seq !== this.reloadSeq) return   // a newer reload superseded this one

        const nodes = this.Nodes
        nodes.Clear()
        for (const n of built) nodes.Add(n)
        this.set_property_value(MetaModelsService.IsEmptyKey, built.length === 0)
        await this.Provider.get(TodlPresentationRegistry.Key)?.discover()

        // A newer reload may have superseded this one across the discover await;
        // only the latest announces so subscribers reconcile once.
        if (seq === this.reloadSeq) this.fireMetaModelsChanged()
    }

    // Asynchronously flag which entity rows have an openable wiki page (→ their
    // "Open Wiki" menu shows). Runs per version subtree as it loads lazily; a
    // stale-item guard keeps a late resolve from writing onto a reused node.
    private markWiki(nodes: readonly MetaModelTreeNode[]): void
    {
        const wiki = this.Provider.get(WikiService.Key)
        if (wiki === undefined) return
        for (const n of nodes)
        {
            if (n.Kind !== MetaModelNodeKind.Entity) continue
            const concept = n.Concept
            if (concept.length === 0) continue
            void wiki.hasWiki(concept).then((h) => { if (n.Concept === concept) n.HasWiki = h })
        }
    }

    // Delete a published meta-model — one version (`<id>/<version>`) or a whole id
    // (all versions). Warns in the confirm about installed libraries that bind it;
    // headless (no DialogService) proceeds. Cleans an emptied id folder, then
    // reloads so the row disappears.
    public async deleteTarget(target: DeleteTarget): Promise<void>
    {
        const backend = ensureMetaModelsBackend(this.Provider)
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs !== undefined)
        {
            const deps = await this.dependentLibraries(target.id, target.version)
            const message = await this.confirmMessage(backend, target, deps)
            const vm = new ConfirmDialogModel(message, 'Delete', (r) => dialogs.Close(r))
            const ok = await dialogs.Show<boolean>({ Title: 'Delete Meta-MuralBase', Content: vm, Width: 440 })
            if (ok !== true) return
        }

        const path = target.version !== undefined ? `${target.id}/${target.version}` : target.id
        await backend.Delete(path)
        if (target.version !== undefined)
        {
            const remaining = (await backend.List(target.id)).filter((e) => e.IsDirectory)
            if (remaining.length === 0) await backend.Delete(target.id)
        }
        await this.reload()
    }

    // Installed libraries bound to this meta-model, by name. Degrades to [] if the
    // libraries store is unavailable.
    private async dependentLibraries(id: string, version?: string): Promise<string[]>
    {
        try
        {
            const libs = await discoverLibraries(ensureLibrariesBackend(this.Provider))
            return dependentLibraryNames(libs, id, version)
        }
        catch { return [] }
    }

    private async confirmMessage(backend: IStorage, target: DeleteTarget, deps: string[]): Promise<string>
    {
        let base: string
        if (target.version !== undefined)
        {
            base = `Delete meta-model "${target.id} ${target.version}"? This removes the published copy.`
        }
        else
        {
            const n = (await backend.List(target.id)).filter((e) => e.IsDirectory).length
            base = `Delete all ${n} version(s) of meta-model "${target.id}"? This removes every published copy.`
        }
        if (deps.length === 0) return base
        return `${base}\n\n${deps.length} installed library(ies) bind to it: ${deps.join(', ')}. `
            + `They'll fail to resolve until rebound. (Architecture projects that bind it aren't tracked here.)`
    }

}

// The names of installed libraries that bind the given meta-model — all versions
// when `version` is omitted, else the exact version. Pure over already-loaded
// libraries.
export function dependentLibraryNames(libs: readonly LoadedLibrary[], id: string, version?: string): string[]
{
    return libs
        .filter((l) => l.metaModel.id === id && (version === undefined || l.metaModel.version === version))
        .map((l) => l.name)
}
