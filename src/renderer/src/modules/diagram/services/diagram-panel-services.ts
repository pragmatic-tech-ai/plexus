// diagram-panel-services.ts — the unified Toolbox: the primary palette for
// visual architecture content.
//
// One global left-panel Capability (rendered by `DataTemplate [DataType =
// ToolboxService]` in diagram.resources.mu). It POPULATES the mural
// ToolboxRepository: mural's built-in *Shapes* page (via ensureToolboxDefaults)
// plus one page per taxonomy an author marked `annotate toolbox { visible = true
// }`, aggregated across every published meta-model and library. Each toolbox item
// carries a visual descriptor resolved by the tile/canvas/preview through the
// shared ToolboxVisualPresenter, and a drop factory key. A term marked `toolbox {
// visible = false }` is dropped from its page.
import {
    Application,
    MetaData,
    MuralBase,
    ObservableCollection,
    ResourceDictionary,
    ServiceKey,
    type IServiceProvider,
    type ServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    ApplicationSettings,
    ContentHostService,
    DocumentsContentHostService,
    ensureToolboxDefaults,
    Setting,
    ToolboxRepository,
    ToolboxPage,
    type IActivatable,
    type IDocument,
    type ToolboxItem,
} from '@pragmatic-tech-ai/mural/framework'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { PlexusPanelService } from '../../../services/panels/panel-services.js'
import { StorageProviderRegistry } from '../../../services/storage/storage-provider-registry.js'
import { ArchDiagramBindingService } from '../../architecture-projects/services/arch-diagram-binding-service.js'
import { ArchitectureModelService } from '../../architecture-projects/services/architecture-model-service.js'
import type { ArchModel } from '../../architecture-projects/services/arch-model.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { LibrariesPanelService } from '../../library/services/libraries-panel-service.js'
import { MetaModelsService } from '../../meta-model/services/meta-models-service.js'
import { LibraryToolboxPage } from './library-toolbox-page.js'
import { ModelToolboxPage, ScenarioToolboxPage } from '../../architecture-projects/services/scoped-toolbox-page.js'
import { modelPageItems, scenarioPageItems } from '../../architecture-projects/services/arch-model-toolbox-contributor.js'
import { toolboxContextsOf } from '../../architecture-projects/services/toolbox-contexts.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ensureMetaModelsBackend } from '../../meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../library/services/libraries-backend.js'
import { scanPublishedModels } from '../../meta-model/services/meta-model-tree-builder.js'
import { projectToolbox, type ToolboxTaxonomy } from '../../meta-model/services/toolbox-projection.js'
import { registerArchToolboxAdapters } from './register-arch-toolbox-adapters.js'
import { TodlPresentationRegistry } from './todl-presentation-registry.js'

// The mural static pages (Shapes + Callouts/Text/Containers) ensureToolboxDefaults
// creates — context-free, always visible, kept as-is across page-set reconciles.
const STATIC_PAGE_IDS = new Set(['shapes', 'annotate'])

// Setting keys (match the SettingDefinitions in diagram.module.mu) and the app
// resource keys the toolbox tile template binds via @ToolboxItemWidth/@ToolboxItemHeight.
const ITEM_WIDTH_SETTING = 'toolbox.item.width'
const ITEM_HEIGHT_SETTING = 'toolbox.item.height'
export const ITEM_WIDTH_RESOURCE = 'ToolboxItemWidth'
export const ITEM_HEIGHT_RESOURCE = 'ToolboxItemHeight'
const ITEM_SIZE_FALLBACK = 48

// Mirror the toolbox item size settings into the resource dictionary the tile
// template binds. A non-number value falls back to 48. Pure over its inputs so it
// is unit-testable without an Application.
export function applyToolboxItemSize(settings: { Get(key: string): unknown }, resources: ResourceDictionary): void
{
    const w = settings.Get(ITEM_WIDTH_SETTING)
    const h = settings.Get(ITEM_HEIGHT_SETTING)
    resources.Set(ITEM_WIDTH_RESOURCE, typeof w === 'number' ? w : ITEM_SIZE_FALLBACK)
    resources.Set(ITEM_HEIGHT_RESOURCE, typeof h === 'number' ? h : ITEM_SIZE_FALLBACK)
}


export class ToolboxService extends PlexusPanelService implements IActivatable
{
    public static readonly Key = new ServiceKey<ToolboxService>('ToolboxService')

    // The palette panel binds `$Pages`; this DP is pointed at the repository's
    // Pages collection on the first reload so the panel reflects it live.
    public static readonly PagesKey = MuralBase.RegisterProperty<ObservableCollection<ToolboxPage>>(
        ToolboxService, 'Pages',
        undefined as unknown as ObservableCollection<ToolboxPage>, MetaData.None)

    // Bumped each syncPageSet; a slower earlier pass whose seq is stale skips its
    // mutation, so overlapping ctor / trigger reconciles can't interleave.
    private syncSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider, [])
        this.set_property_value(ToolboxService.PagesKey, new ObservableCollection<ToolboxPage>())
        this.syncItemSize()
        this.wireTriggers()
        void this.syncPageSet()
    }

    // Wire each concern to its own trigger. The page SET changes rarely (a project
    // opened/closed, a library/meta-model published) → syncPageSet. The active
    // document changes often → applyContexts flips page visibility ONLY (no content
    // work). All no-ops headless / before the services are wired.
    private wireTriggers(): void
    {
        const services = this.services()
        services.get(ProjectExplorerService.Key)?.OpenProjects.Subscribe(() => { void this.syncPageSet() })
        services.get(LibrariesPanelService.Key)?.onLibrariesChanged(() => { void this.syncPageSet() })
        services.get(MetaModelsService.Key)?.onMetaModelsChanged(() => { void this.syncPageSet() })
        const host = services.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.PropertyChanged(DocumentsContentHostService.ActiveDocumentKey).subscribe(() => { void this.onActiveDocChanged() })
        // Belt-and-suspenders: a document bound via the OpenDocuments sync path
        // (not the active-doc path) also gets its contexts stamped — re-apply so
        // its pages settle. Idempotent when the active doc is already stamped.
        services.get(ArchDiagramBindingService.Key)?.onContextsChanged(() => this.applyContexts())
    }

    // Mirror the toolbox item size settings into app resources (@ToolboxItemWidth /
    // @ToolboxItemHeight) that the tile template binds, and keep them live: a
    // change to either setting re-applies, so the DynamicResource-bound tiles
    // resize without a reload. No-op headless (no Application) or before settings
    // are wired.
    private syncItemSize(): void
    {
        const app = Application.current
        if (app === null || app === undefined) return
        const settings = this.services().get(ApplicationSettings.Key)
        if (settings === undefined) return

        const apply = (): void => applyToolboxItemSize(settings, app.Resources)
        apply()
        for (const key of [ITEM_WIDTH_SETTING, ITEM_HEIGHT_SETTING]) {
            settings.GetSetting(key)?.PropertyChanged(Setting.ValueKey).subscribe(apply)
        }
    }

    // The mural ToolboxRepository singleton — the drop router and the presenter both
    // key off Application.current.Services, so populate the repository there. Falls
    // back to the injected provider in headless tests without an Application.
    public get Repository(): ToolboxRepository
    {
        return this.services().getRequired(ToolboxRepository.Key)
    }

    public get Pages(): ObservableCollection<ToolboxPage> { return this.get_property_value(ToolboxService.PagesKey) }

    // IActivatable: on re-activation just re-apply visibility (the page set is kept
    // live by its own triggers — no rebuild).
    public OnActivated(): void { this.applyContexts() }

    // The active document changed. If it is an architecture diagram, ensure its
    // binding is attached FIRST — the binding stamps the doc's ToolboxContexts,
    // and running the visibility pass against an unstamped doc would compute an
    // empty context, transiently collapsing the in-context library pages and
    // destroying + regenerating their tiles when the stamp lands a tick later.
    // Awaiting the (idempotent, instant-for-bound) ensureBound gives one clean
    // transition. A non-architecture doc no-ops the ensureBound.
    private async onActiveDocChanged(): Promise<void>
    {
        const doc = this.activeDoc() as IDocument | undefined
        if (doc !== undefined) await this.services().get(ArchDiagramBindingService.Key)?.ensureBound(doc)
        this.applyContexts()
    }

    // Reconcile the PAGE SET to the current sources: static pages, one published-
    // taxonomy page per library/meta-model taxonomy, and a Model + Scenarios page
    // per open architecture project. Existing page instances are reused by id (so
    // their collapse state and live tiles survive), pages for vanished sources are
    // detached + removed. Content is pushed by key (setTerms) / self-reconciled by
    // the model pages — never a Clear()+rebuild. Runs on project-set / publish
    // changes, NOT on every active-document change.
    public async syncPageSet(): Promise<void>
    {
        const seq = ++this.syncSeq
        const services = this.services()
        ensureToolboxDefaults(services)
        registerArchToolboxAdapters(services)
        const repo = this.Repository

        // Gather everything async FIRST, then mutate synchronously under a seq guard
        // — so two overlapping syncPageSet calls (e.g. ctor + a trigger) can't
        // interleave their reconciles on the shared repo.Pages.
        if (services.get(StorageProviderRegistry.Key) !== undefined) {
            await services.get(TodlPresentationRegistry.Key)?.discover()
        }
        const taxonomies = await this.collectTaxonomies()
        const archModels = await this.openArchModels()
        if (seq !== this.syncSeq) return   // a newer syncPageSet superseded this one

        this.set_property_value(ToolboxService.PagesKey, repo.Pages)
        const byId = new Map(repo.Pages.ToArray().map((p) => [p.Id, p]))
        const desired: ToolboxPage[] = []

        // Static pages (Shapes, Callouts) — context-free, always visible.
        for (const p of repo.Pages.ToArray()) if (STATIC_PAGE_IDS.has(p.Id)) desired.push(p)

        // Published-taxonomy pages (library + meta-model). A page id seen across
        // sources merges their terms (no cross-source term dedup — each source
        // contributes its own; reconcile-by-key collapses a genuinely shared term).
        const termsByPage = new Map<LibraryToolboxPage, Array<{ id: string; label: string }>>()
        const builtTax = new Map<string, LibraryToolboxPage>()   // by page id, across this pass
        for (const { tax, isLibrary, sourceRef } of taxonomies) {
            const id = 'tax:' + tax.id
            let page = builtTax.get(id)
            if (page === undefined) {
                const existing = byId.get(id)
                page = existing instanceof LibraryToolboxPage
                    ? existing
                    : new LibraryToolboxPage(id, tax.label, sourceRef, isLibrary ? '' : 'mm:', this.services().getRequired(TodlPresentationRegistry.Key))
                builtTax.set(id, page)
                desired.push(page)
            }
            const acc = termsByPage.get(page) ?? []
            acc.push(...tax.terms)
            termsByPage.set(page, acc)
        }

        // Model + Scenarios page per open architecture project (context = its model).
        for (const { model, namespace } of archModels) {
            const mid = 'arch:model:' + namespace
            const sid = 'arch:scenarios:' + namespace
            const mExisting = byId.get(mid)
            desired.push(mExisting instanceof ModelToolboxPage ? mExisting
                : new ModelToolboxPage(mid, 'Model: ' + namespace, 'model:' + namespace, {
                    resolveItems: () => this.modelItems(model),
                    onSourceChanged: (cb) => model.onChanged(cb),
                }))
            const sExisting = byId.get(sid)
            desired.push(sExisting instanceof ScenarioToolboxPage ? sExisting
                : new ScenarioToolboxPage(sid, 'Scenarios: ' + namespace, 'model:' + namespace, {
                    resolveItems: () => this.scenarioItems(model),
                    onSourceChanged: (cb) => model.onChanged(cb),
                }))
        }

        this.reconcilePages(desired)
        for (const [page, terms] of termsByPage) page.setTerms(terms)
        this.applyContexts()
    }

    // Reconcile repo.Pages to `desired` by id: detach + remove pages no longer
    // desired, insert + attach new ones, move to match order. Reused instances keep
    // their subscriptions and state.
    private reconcilePages(desired: readonly ToolboxPage[]): void
    {
        const pages = this.Repository.Pages
        const desiredIds = new Set(desired.map((p) => p.Id))
        for (let i = pages.Count - 1; i >= 0; i--) {
            const p = pages.Get(i)!
            if (!desiredIds.has(p.Id)) { p.detach(); pages.RemoveAt(i) }
        }
        for (let target = 0; target < desired.length; target++) {
            const next = desired[target]!
            let live = -1
            for (let i = 0; i < pages.Count; i++) if (pages.Get(i)!.Id === next.Id) { live = i; break }
            if (live === -1) { pages.Insert(target, next); next.attach() }
            else if (live !== target) pages.Move(live, target)
        }
    }

    // Flip each page's visibility for the active document's context tokens. Content
    // pages recompute cheaply (by key) only if they are the now-active context.
    public applyContexts(): void
    {
        const doc = this.activeDoc()
        // Skip while the active doc is an architecture diagram still pending its
        // async ToolboxContexts stamp — running now would see an empty context and
        // collapse every in-context page, only for the stamp's onContextsChanged to
        // re-show them a tick later (churning ~400 tiles). The stamp re-runs this.
        const binding = this.services().get(ArchDiagramBindingService.Key)
        if (binding?.isBindingPending(doc as IDocument) === true) return
        const ctx = toolboxContextsOf(doc)
        for (const p of this.Repository.Pages.ToArray()) p.applyContext(ctx)
    }

    // The active document, or undefined. Overridable seam for tests.
    protected activeDoc(): unknown
    {
        const host = this.services().get(ContentHostService.Key) as DocumentsContentHostService | undefined
        return host?.ActiveDocument
    }

    // The models of every open architecture project (stable per project via the
    // model service's cache). Overridable seam for tests.
    protected async openArchModels(): Promise<Array<{ model: ArchModel; namespace: string }>>
    {
        const explorer = this.services().get(ProjectExplorerService.Key)
        const modelSvc = this.services().get(ArchitectureModelService.Key)
        if (explorer === undefined || modelSvc === undefined) return []
        const out: Array<{ model: ArchModel; namespace: string }> = []
        for (const op of explorer.OpenProjects.ToArray()) {
            if (op.Project.Type !== 'architecture') continue
            try { const model = await modelSvc.modelFor(op); out.push({ model, namespace: model.namespace }) }
            catch { /* project not loadable yet — skip */ }
        }
        return out
    }

    // A model page's items: its in-scope, unplaced entities — but only when its
    // diagram is the active document (scope + placed are active-diagram state).
    private modelItems(model: ArchModel): ToolboxItem[]
    {
        const binding = this.services().get(ArchDiagramBindingService.Key)
        const doc = this.activeDoc() as IDocument | undefined
        const registry = this.services().get(TodlPresentationRegistry.Key)
        if (binding === undefined || doc === undefined || registry === undefined || binding.modelForDocument(doc) !== model) return []
        return modelPageItems(model, binding.scopeForDocument(doc) ?? new Set<string>(), binding.placedIds(doc), registry)
    }

    private scenarioItems(model: ArchModel): ToolboxItem[]
    {
        const binding = this.services().get(ArchDiagramBindingService.Key)
        const doc = this.activeDoc() as IDocument | undefined
        const registry = this.services().get(TodlPresentationRegistry.Key)
        if (binding === undefined || doc === undefined || registry === undefined || binding.modelForDocument(doc) !== model) return []
        return scenarioPageItems(model, binding.scopeForDocument(doc) ?? new Set<string>(), registry)
    }

    // Scan the published-content backends into (taxonomy, source) triples. Overridable
    // seam for tests. Every term's visual resolves through the shared TodlVisualResolver;
    // the `isLibrary` flag only decides the descriptor key (bare class id vs `mm:` term id).
    // `sourceRef` is the source package key (`<id>@<version>`) reload() filters against
    // the active diagram's referenced bases (see activeScope).
    protected async collectTaxonomies(): Promise<Array<{ tax: ToolboxTaxonomy; isLibrary: boolean; sourceRef: string }>>
    {
        const out: Array<{ tax: ToolboxTaxonomy; isLibrary: boolean; sourceRef: string }> = []
        for (const { backend, isLibrary } of this.sourceBackends()) {
            const models = await scanPublishedModels(backend)
            for (const { id, versions } of models) {
                for (const version of versions) {
                    const doc = await this.readModel(backend, `${id}/${version}`)
                    if (doc === undefined) continue
                    const sourceRef = `${id}@${version}`
                    for (const tax of projectToolbox(doc)) out.push({ tax, isLibrary, sourceRef })
                }
            }
        }
        return out
    }

    private services(): ServiceProvider
    {
        return (Application.current?.Services ?? this.Provider) as ServiceProvider
    }

    // The published-content backends to scan, each best-effort: a missing backend
    // (headless, or storage not wired) contributes nothing rather than throwing.
    // Meta-models → `mm:`-keyed terms; libraries → class-id-keyed terms.
    private sourceBackends(): Array<{ backend: IStorage; isLibrary: boolean }>
    {
        if (this.Provider.get(StorageProviderRegistry.Key) === undefined) return []
        const out: Array<{ backend: IStorage; isLibrary: boolean }> = []
        try { out.push({ backend: ensureMetaModelsBackend(this.Provider), isLibrary: false }) } catch { /* no meta-models backend */ }
        try { out.push({ backend: ensureLibrariesBackend(this.Provider), isLibrary: true }) } catch { /* no libraries backend */ }
        return out
    }

    private async readModel(backend: IStorage, base: string): Promise<TodlDocument | undefined>
    {
        try { return JSON.parse(await backend.ReadText(`${base}/model.json`)) as TodlDocument }
        catch { return undefined }
    }
}
