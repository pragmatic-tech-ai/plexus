import { Application, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService,
    DiagramDocument,
    DocumentsContentHostService,
    ToolboxRepository,
    ToolboxVisualDescriptor,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import type { Entity, Repository } from '@pragmatic-tech-ai/todl'

import { TodlVisualResolverKey } from '../../diagram/services/todl-visual-resolver.js'
import { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'
import { EntityIconVM } from '../../diagram/services/entity-icon-vm.js'
import { ArchToolboxItem } from '../../diagram/services/arch-toolbox-item.js'
import { iconEntityKey } from './arch-icon.js'
import { ArchModelInstanceDropFactoryKey } from './arch-model-instance-drop-factory.js'
import { ArchScenarioDropFactoryKey } from './arch-scenario-drop-factory.js'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { WikiService } from '../../../services/wiki/wiki-service.js'
import type { ArchModel } from './arch-model.js'

const PAGE_ID = 'arch:model'
const SCENARIO_PAGE_ID = 'arch:scenarios'
const SCENARIO_CONCEPT = 'scenario'

// An entity's display label: its `label`, else `name`, else its id.
function entityLabel(e: Entity): string
{
    const v = e.field('label') ?? e.field('name')
    return v !== undefined ? String(v) : e.id
}

// A concept is toolbox-visible unless it explicitly opts out with
// `annotate toolbox { visible = false }` (the same author-declared `toolbox`
// annotation the meta-model module's toolbox-projection uses). Absent
// annotation → visible. Read from the loaded Repository, keyed on the
// `<concept>@toolbox` annotation node — the same path iconEntityKey reads
// `<id>@icon`. Booleans resolve to real booleans here, so opt-out is `!== false`.
export function conceptToolboxVisible(repo: Repository, concept: string): boolean
{
    return repo.resolve(`${concept}@toolbox`)?.attrs.get('visible') !== false
}

// The toolbox items for a diagram's "Model:" page: one per in-scope entity that
// is NOT already placed on the diagram. Each drops through the place-existing
// factory (keyed by the entity id, `instance:<id>`).
export function modelPageItems(model: ArchModel, scope: ReadonlySet<string>, placed: ReadonlySet<string>, registry: TodlPresentationRegistry): ArchToolboxItem[]
{
    const repo = model.repository()
    const inScope = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const items: ArchToolboxItem[] = []
    for (const e of model.entities()) {
        if (placed.has(e.id) || !inScope(e.concept) || !conceptToolboxVisible(repo, e.concept)) continue
        const key = iconEntityKey(repo, e) ?? e.concept
        const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
        items.push(new ArchToolboxItem('instance:' + e.id, entityLabel(e), descriptor, ArchModelInstanceDropFactoryKey, new EntityIconVM(registry, key), e.concept))
    }
    return items
}

// The scenarios page title — carries the model namespace so it reads per-model,
// mirroring the "Model: <namespace>" page (the page is already active-document
// scoped; this just names which model's scenarios it lists).
export function scenarioPageTitle(model: ArchModel): string
{
    return 'Scenarios: ' + model.namespace
}

// The toolbox items for a diagram's "Scenarios" page: one per in-scope scenario
// entity. Each drops through the scenario factory (`scenario:<id>`), which
// materializes the whole flow (participants + step connectors).
export function scenarioPageItems(model: ArchModel, scope: ReadonlySet<string>, registry: TodlPresentationRegistry): ArchToolboxItem[]
{
    const repo = model.repository()
    const inScope = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const items: ArchToolboxItem[] = []
    for (const e of model.entities()) {
        if (e.concept !== SCENARIO_CONCEPT || !inScope(e.concept) || !conceptToolboxVisible(repo, e.concept)) continue
        const key = iconEntityKey(repo, e) ?? e.concept
        const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, key)
        items.push(new ArchToolboxItem('scenario:' + e.id, entityLabel(e), descriptor, ArchScenarioDropFactoryKey, new EntityIconVM(registry, key), e.concept))
    }
    return items
}

// App-scoped: watches the ACTIVE document and, when it is an architecture
// diagram, contributes a dynamic "Model: <namespace>" toolbox page listing the
// in-scope entities not yet on the canvas. Refreshes on model change, scope
// change (both fire the model's onChanged), and node add/remove (view-only
// deletes make an entity re-appear). Removes the page when the active document
// is not an architecture diagram.
export class ArchModelToolboxContributor extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchModelToolboxContributor>('ArchModelToolboxContributor')

    private modelOff: (() => void) | undefined
    private nodesOff: (() => void) | undefined
    // ONE registry subscription (owner-driven icon reactivity): on discovery it
    // rebuilds the toolbox pages, so each recreated ArchToolboxItem's fresh
    // EntityIconVM resolves the now-current icon key. Held for the service's life.
    private registryOff: (() => void) | undefined
    private activeDoc: IDocument | undefined

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        if (host === undefined) return
        host.PropertyChanged(DocumentsContentHostService.ActiveDocumentKey).subscribe(() => { void this.onActiveChanged(host) })
        this.registryOff = this.Provider.get(TodlPresentationRegistry.Key)?.onChanged(() => this.refresh())
        void this.onActiveChanged(host)
    }

    public dispose(): void
    {
        this.modelOff?.(); this.modelOff = undefined
        this.nodesOff?.(); this.nodesOff = undefined
        this.registryOff?.(); this.registryOff = undefined
    }

    private async onActiveChanged(host: DocumentsContentHostService): Promise<void>
    {
        this.modelOff?.(); this.modelOff = undefined
        this.nodesOff?.(); this.nodesOff = undefined
        this.activeDoc = host.ActiveDocument

        const doc = this.activeDoc
        const bindingSvc = this.Provider.get(ArchDiagramBindingService.Key)
        if (doc === undefined || bindingSvc === undefined) { this.removePage(); return }
        await bindingSvc.ensureBound(doc)
        const model = bindingSvc.modelForDocument(doc)
        if (model === undefined) { this.removePage(); return }

        this.modelOff = model.onChanged(() => this.refresh())
        if (doc instanceof DiagramDocument) this.nodesOff = doc.Nodes.Subscribe(() => this.refresh())
        this.refresh()
    }

    private refresh(): void
    {
        const doc = this.activeDoc
        const bindingSvc = this.Provider.get(ArchDiagramBindingService.Key)
        const model = doc !== undefined ? bindingSvc?.modelForDocument(doc) : undefined
        if (doc === undefined || bindingSvc === undefined || model === undefined) { this.removePage(); return }

        const repo = this.repository()
        if (repo === undefined) return
        // Each tile carries an EntityIconVM resolved against the presentation
        // registry; without it there is nothing to render an icon from, so skip.
        const registry = this.Provider.get(TodlPresentationRegistry.Key)
        if (registry === undefined) return
        const scope = bindingSvc.scopeForDocument(doc) ?? new Set(model.viewpoints().map((v) => v.id))
        const placed = bindingSvc.placedIds(doc)
        const page = repo.EnsurePage(PAGE_ID, 'Model: ' + model.namespace)
        page.Items.Clear()
        const modelItems = modelPageItems(model, scope, placed, registry)
        for (const item of modelItems) page.Items.Add(item)
        // Generic drawing tools (container, text, callout) live on the framework's
        // "Callouts, Text & Containers" page (ensureToolboxDefaults), not here.
        this.markWiki(modelItems, model.repository())

        // A "Scenarios" page lists the in-scope scenarios; dropping one
        // materializes its whole flow. Removed when there are none in scope.
        const scenarioItems = scenarioPageItems(model, scope, registry)
        if (scenarioItems.length > 0) {
            const spage = repo.EnsurePage(SCENARIO_PAGE_ID, scenarioPageTitle(model))
            spage.Items.Clear()
            for (const item of scenarioItems) spage.Items.Add(item)
            this.markWiki(scenarioItems, model.repository())
        } else {
            repo.RemovePage(SCENARIO_PAGE_ID)
        }
    }

    // Flag which tiles have an openable wiki page (→ their "Open Wiki" menu item
    // shows). A synchronous `repo.resolve('X@wiki')` off the loaded model — no
    // filesystem, no source recompile — so rebuilding the toolbox on a model change
    // (a scenario drop) costs a map lookup per tile, not a full model recompile.
    private markWiki(items: readonly ArchToolboxItem[], repo: Repository): void
    {
        const wiki = this.Provider.get(WikiService.Key)
        if (wiki === undefined) return
        for (const it of items) {
            if (it.Concept.length === 0) continue
            it.HasWiki = wiki.hasWikiIn(repo, it.Concept)
        }
    }

    private removePage(): void
    {
        this.repository()?.RemovePage(PAGE_ID)
        this.repository()?.RemovePage(SCENARIO_PAGE_ID)
    }

    // The app-level ToolboxRepository the ToolboxService populates (drop router +
    // presenter key off Application.current.Services), falling back to the injected
    // provider in headless tests.
    private repository(): ToolboxRepository | undefined
    {
        return (Application.current?.Services ?? this.Provider).get(ToolboxRepository.Key)
    }
}
