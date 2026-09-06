import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, DialogService, StatusService, type DocumentsContentHostService, type IDocument } from '@pragmatic-tech-ai/mural/framework'

import { FileDiagramStorage } from '../../diagram/persistence/file-diagram-storage.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { WorkspaceBaseResolver } from '../../../services/projects/workspace-base-resolver.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { ArchDiagramBinding } from './arch-diagram-binding.js'
import { ArchNavigationService } from './arch-navigation-service.js'
import { DropCandidateChooserService } from './drop-candidate-chooser-service.js'
import { WikiService, type WikiTarget } from '../../../services/wiki/wiki-service.js'
import { wikiPathOf } from '../../../services/wiki/wiki-locator.js'
import { locateWikiFile } from '../../../services/projects/wiki-origin.js'
import type { ArchModel } from './arch-model.js'
import { loadViewpoints, writeViewpoints } from './arch-diagram-viewpoints-store.js'
import { readScenarios, writeScenarios } from './arch-diagram-scenarios-store.js'
import { nodesLeavingScope, type LeavingNode } from './viewpoint-scope-reconcile.js'
import { registerArchNodeSerializer } from './arch-node-serializer.js'

// App-scoped observer: watches the open-documents set and, for each opened
// DiagramDocument whose owning project is an architecture project, attaches an
// ArchDiagramBinding against that project's ArchModel; disposes it on close.
// The generic diagram is untouched — a standalone diagram simply has no binding.
// The framework's IToolboxContextTarget is readonly; this mutable shape is the
// typed cast the binding uses to stamp the live context set onto the document.
interface ToolboxContextTarget { ToolboxContexts: Set<string> }

export class ArchDiagramBindingService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchDiagramBindingService>('ArchDiagramBindingService')

    private readonly bindings = new Map<IDocument, ArchDiagramBinding>()
    // In-flight attach promise per document. Concurrent callers (the OpenDocuments
    // sync and ensureBound) share the SAME promise, so whoever awaits it observes
    // the binding once it is set — a plain "already attaching?" guard would let the
    // second caller resolve before the first finished creating the binding.
    private readonly attaching = new Map<IDocument, Promise<void>>()
    // Listeners notified after a document's ToolboxContexts are stamped. The
    // ToolboxService subscribes to re-apply page visibility: the stamp is async
    // (it awaits the model + referenced refs), so it lands AFTER the document's
    // ActiveDocument change already ran the visibility pass against an unstamped
    // doc — this signal is what re-shows the now-in-context library / model pages.
    private readonly contextsChangedListeners = new Set<() => void>()

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        registerArchNodeSerializer()
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => { void this.sync(host) })
        // Teach the wiki service to resolve a concept's page through the active
        // architecture model — off the loaded repo (cheap) and by provenance (the
        // declaring package's backend, or an open project's live source).
        this.Provider.get(WikiService.Key)?.RegisterResolver((concept) => this.resolveWikiTarget(concept))
    }

    // Resolve a concept's wiki page via the active diagram's ArchModel: the path
    // off the loaded repo, the storage by the concept's provenance. Undefined when
    // there is no active arch model or the concept declares no reachable page (→
    // the wiki service falls back to its legacy open-project probe).
    private resolveWikiTarget(concept: string): WikiTarget | undefined
    {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        if (doc === undefined) return undefined
        const model = this.modelForDocument(doc)
        if (model === undefined) return undefined
        const path = wikiPathOf(model.repository(), concept)
        if (path === undefined) return undefined
        const origin = model.wikiOriginOf(concept)
        if (origin === undefined) return undefined
        const loc = locateWikiFile(this.Provider, origin, path)
        return { id: `${loc.storage.Root}::${loc.path}`, storage: loc.storage, path: loc.path }
    }

    private async sync(host: DocumentsContentHostService): Promise<void>
    {
        const current = new Set(host.OpenDocuments.ToArray())

        // Closed documents: dispose + forget.
        for (const [doc, binding] of [...this.bindings]) {
            if (!current.has(doc)) {
                binding.dispose()
                this.bindings.delete(doc)
            }
        }

        // Newly opened architecture diagrams: attach.
        for (const doc of current) await this.attachDoc(host, doc)
    }

    // Attach a binding to one document if it is an open architecture diagram that
    // isn't already bound. Idempotent, and concurrency-safe: a call made while an
    // attach for the same document is already in flight returns that same promise,
    // so it resolves only once the binding exists (see `attaching`).
    private attachDoc(host: DocumentsContentHostService, doc: IDocument): Promise<void>
    {
        if (this.bindings.has(doc)) return Promise.resolve()
        const inflight = this.attaching.get(doc)
        if (inflight !== undefined) return inflight
        const p = this.attachDocInner(host, doc).finally(() => { this.attaching.delete(doc) })
        this.attaching.set(doc, p)
        return p
    }

    private async attachDocInner(host: DocumentsContentHostService, doc: IDocument): Promise<void>
    {
        if (!(doc instanceof DiagramDocument)) return
        const op = this.projectFor(doc)
        if (op === undefined) return
        const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
        // Liveness guard: bind only if the doc is still live after the async gap
        // (it may have closed). The active document is definitionally live — accept
        // it even before it lands in OpenDocuments, since ActiveDocument can fire
        // BEFORE OpenDocuments when opening a diagram. Missing this made ensureBound
        // (called from the active-doc change) bail without stamping ToolboxContexts,
        // so the toolbox's visibility pass ran against an empty context — hiding then
        // re-showing every in-context page and churning ~400 tiles per switch.
        if (host.OpenDocuments.ToArray().includes(doc) || host.ActiveDocument === doc) {
            const chooser = this.Provider.get(DropCandidateChooserService.Key)
            const wiki = this.Provider.get(WikiService.Key)
            const status = this.Provider.get(StatusService.Key)
            const dialogs = this.Provider.get(DialogService.Key)
            const nav = this.Provider.get(ArchNavigationService.Key)
            const binding = new ArchDiagramBinding(doc, model, chooser, wiki, status, dialogs, nav, op.Project.RootPath)
            binding.attach()
            const store = doc.Storage
            if (store instanceof FileDiagramStorage) {
                // Governing viewpoints travel with the diagram (its metadata),
                // falling back to the legacy manifest for older diagrams.
                const vps = await loadViewpoints(doc, store.ProjectStorage, store.Path)
                if (vps !== undefined) binding.setScope(vps)
            }
            // Restore the diagram's shown scenarios so their step connectors
            // re-project on open (the metadata is already deserialized).
            binding.setScenarios(readScenarios(doc))
            // Publish the document's toolbox-context tokens (the ToolboxService reads
            // these on activation to show the relevant library / model / scenario
            // pages): every published ref the project references, plus its own model.
            // Best-effort — a missing/partial resolver must not break the binding.
            const contexts = new Set<string>(['model:' + model.namespace])
            try {
                const resolver = this.Provider.get(WorkspaceBaseResolver.Key)
                if (resolver !== undefined) for (const r of await resolver.referencedPublishedRefs(model.Storage)) contexts.add(r)
            } catch { /* leave contexts at just the model token */ }
            ;(doc as unknown as ToolboxContextTarget).ToolboxContexts = contexts
            binding.model.notifyChanged()
            this.bindings.set(doc, binding)
            // Contexts are now on the document — re-run the toolbox visibility pass
            // (the ActiveDocument change already ran it against the unstamped doc).
            for (const cb of this.contextsChangedListeners) cb()
        }
    }

    // Ensure a document is bound before a caller acts on its binding — closes the
    // gap between opening a diagram and the OpenDocuments subscription attaching
    // it. A no-op for a non-architecture or already-bound document.
    public async ensureBound(doc: IDocument): Promise<void>
    {
        if (this.bindings.has(doc)) return
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        if (host !== undefined) await this.attachDoc(host, doc)
    }

    // Bind a diagram document for a ONE-SHOT, off-editor purpose (e.g. headless
    // export rendering). Runs the same core binding attachDocInner does — model
    // lookup, ArchDiagramBinding.attach() (which rescans synchronously, stamping
    // node concepts/descriptors), viewpoint scope + scenarios — but WITHOUT the
    // liveness guard (the caller owns a freshly-loaded, definitely-live doc) and
    // WITHOUT the open-time toolbox-context side effects (which would perturb the
    // live UI). The caller MUST dispose() the returned binding when done.
    public async bindForRender(op: OpenProject, doc: DiagramDocument): Promise<ArchDiagramBinding>
    {
        const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
        const chooser = this.Provider.get(DropCandidateChooserService.Key)
        const wiki = this.Provider.get(WikiService.Key)
        const status = this.Provider.get(StatusService.Key)
        const dialogs = this.Provider.get(DialogService.Key)
        const binding = new ArchDiagramBinding(doc, model, chooser, wiki, status, dialogs)
        binding.attach()
        const store = doc.Storage
        if (store instanceof FileDiagramStorage) {
            const vps = await loadViewpoints(doc, store.ProjectStorage, store.Path)
            if (vps !== undefined) binding.setScope(vps)
        }
        binding.setScenarios(readScenarios(doc))
        return binding
    }

    // True while `doc` is an architecture diagram that WILL be stamped with
    // ToolboxContexts but isn't yet — the window between it becoming active and the
    // async attach completing. The ToolboxService gates its visibility pass on this:
    // running against a pending (unstamped) doc would compute an empty context and
    // collapse every in-context page, only to re-show them when the stamp lands a
    // tick later (destroying + regenerating ~400 tiles). A non-architecture or
    // already-bound doc is NOT pending — the pass runs normally.
    public isBindingPending(doc: IDocument): boolean
    {
        if (this.bindings.has(doc)) return false
        return doc instanceof DiagramDocument && this.projectFor(doc) !== undefined
    }

    // Subscribe to be notified when a document's toolbox contexts are stamped
    // (see contextsChangedListeners). Returns an unsubscribe. The ToolboxService
    // uses this to re-apply page visibility once the async stamp lands.
    public onContextsChanged(cb: () => void): () => void
    {
        this.contextsChangedListeners.add(cb)
        return () => { this.contextsChangedListeners.delete(cb) }
    }

    // The ArchModel bound to an open document, if it is an attached architecture
    // diagram. Used by the drop factory to route a term-drop.
    public modelForDocument(doc: IDocument): ArchModel | undefined
    {
        return this.bindings.get(doc)?.model
    }

    // The selected-viewpoint scope of an attached architecture diagram.
    public scopeForDocument(doc: IDocument): Set<string> | undefined
    {
        return this.bindings.get(doc)?.scopeSet()
    }

    // Whether an entity is placed as a node on an attached architecture diagram.
    public isPlaced(doc: IDocument, entityId: string): boolean
    {
        return this.bindings.get(doc)?.isPlaced(entityId) ?? false
    }

    // The entity ids currently placed on an attached architecture diagram.
    public placedIds(doc: IDocument): ReadonlySet<string>
    {
        return this.bindings.get(doc)?.placedIds() ?? new Set<string>()
    }

    // The nodes that would leave scope if this diagram were re-scoped to
    // `viewpoints` — for the caller to list in a confirmation before committing.
    // Empty when the document isn't a bound architecture diagram.
    public nodesLeavingScope(doc: IDocument, viewpoints: string[]): LeavingNode[]
    {
        const binding = this.bindings.get(doc)
        if (binding === undefined) return []
        return nodesLeavingScope(doc as DiagramDocument, binding.model, viewpoints)
    }

    // Narrow (or widen) a diagram's scope: drop the nodes that fall out of the
    // new scope, update the binding, persist the selection into the diagram's
    // metadata (so it travels with the file and restores on open), and re-notify
    // so any live view refreshes. The caller confirms node removal beforehand.
    public async setDocumentScope(doc: IDocument, viewpoints: string[]): Promise<void>
    {
        const binding = this.bindings.get(doc)
        if (binding === undefined) return
        const diagram = doc as DiagramDocument
        const leaving = nodesLeavingScope(diagram, binding.model, viewpoints)
        if (leaving.length > 0) diagram.DeleteNodes(leaving.map((l) => l.node))
        binding.setScope(viewpoints)
        writeViewpoints(diagram, viewpoints)
        diagram.Save()
        const store = diagram.Storage
        if (store instanceof FileDiagramStorage) await store.WhenWritten()
        binding.model.notifyChanged()
    }

    // Show a scenario's flow on a diagram: record it in the binding + the
    // diagram metadata (so it travels with the file and re-projects on open),
    // persist, and re-notify so the binding projects its step connectors between
    // the placed participants. The caller places the participant nodes first.
    public async addScenario(doc: IDocument, scenarioId: string): Promise<void>
    {
        const binding = this.bindings.get(doc)
        if (binding === undefined) return
        const diagram = doc as DiagramDocument
        binding.addScenario(scenarioId)
        writeScenarios(diagram, binding.scenarioIds())
        diagram.Save()
        const store = diagram.Storage
        if (store instanceof FileDiagramStorage) await store.WhenWritten()
        binding.model.notifyChanged()
    }

    // The architecture OpenProject that owns this diagram's storage, if any.
    private projectFor(doc: DiagramDocument): OpenProject | undefined
    {
        const store = doc.Storage
        if (!(store instanceof FileDiagramStorage)) return undefined
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        if (explorer === undefined) return undefined
        for (const op of explorer.OpenProjects.ToArray()) {
            if (op.Storage === store.ProjectStorage && op.Project.Type === 'architecture') return op
        }
        return undefined
    }
}
