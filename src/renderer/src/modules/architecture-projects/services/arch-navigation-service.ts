import { toElement, type Element, type Entity, type Repository } from '@pragmatic-tech-ai/todl'
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { NavigationService, type NavigationDestination } from '@pragmatic-tech-ai/mural/framework'
import { WikiOriginKind } from '../../../services/projects/wiki-origin.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { LibrariesPanelService } from '../../library/services/libraries-panel-service.js'
import { collectScenarioFlow, type FlowEntity } from './scenario-flow.js'
import type { ArchModel } from './arch-model.js'

// The two navigator surfaces the routing needs — narrowed so tests can supply
// doubles without the full services.
interface IExplorer { OpenFileInProject(projectId: string, uri: string, line: number, column: number): Promise<void> }
interface ILibraries { RevealTerm(termId: string): boolean }

// Which relation a nav target represents. String-backed so it can drive markup
// (menu labels) and read clearly in tests.
export enum NavTargetKind { Component = 'component', Technology = 'technology', Category = 'category', Scenario = 'scenario' }

// One navigable destination resolved off an architecture node.
export interface NavTarget
{
    readonly kind: NavTargetKind
    readonly id: string
    readonly concept: string
    readonly label: string
}

// The adaptive set of destinations for a node. `technologies` and `categories`
// are lists: a component has ≤1 of each, but a technology node maps to N
// categories (`applicable_to`), so both render single-or-submenu by count.
export interface NavTargets
{
    readonly component?: NavTarget
    readonly technologies: readonly NavTarget[]
    readonly categories: readonly NavTarget[]
    // Scenarios the node PARTICIPATES in (it is a step src/dst) — a usage link,
    // not part of the node's definition, so it drives a separate "Go to Scenario"
    // menu. Any node (component, actor, block…) can participate.
    readonly scenarios: readonly NavTarget[]
}

// Meta-model relationship member names (authoritative:
// plexus_test_projects/meta-models/tech-architecture/concepts). `implemented_by`
// and `category` are single on a component; `applicable_to` is multi on a
// technology.
const IMPLEMENTED_BY = 'implemented_by'
const CATEGORY = 'category'
const APPLICABLE_TO = 'applicable_to'

const COMPONENT = 'component'
const TECHNOLOGY = 'technology'
const CATEGORY_CONCEPT = 'category'
const SCENARIO_CONCEPT = 'scenario'

// Resolves an architecture node's navigable relations (component / technology /
// category) off the composed model. Routing (open source vs reveal in the
// Libraries panel) is added in a later task.
export class ArchNavigationService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ArchNavigationService>('ArchNavigationService')

    protected readonly provider: IServiceProvider

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.provider = provider
    }

    // Adaptive per concept: a component yields component + its technology + its
    // category; a technology yields itself + its applicable_to categories; a
    // category yields itself. Missing relations simply produce empty lists.
    public resolveTargets(model: ArchModel, entityId: string): NavTargets
    {
        const el = this.elementFor(model, entityId)
        // Even an unresolved element can still participate in scenarios (matched by
        // id), so scenarios are resolved independently of the element.
        const scenarios = this.scenarioTargets(model, entityId)
        if (el === undefined) return { technologies: [], categories: [], scenarios }

        const concept = el.concept
        const component = concept === COMPONENT ? this.toTarget(NavTargetKind.Component, el) : undefined

        const techEls: readonly Element[] = concept === TECHNOLOGY ? [el] : (el.refs[IMPLEMENTED_BY] ?? [])
        const technologies = techEls.map((t) => this.toTarget(NavTargetKind.Technology, t))

        const categories = this.categoryElements(concept, el, techEls)
            .map((c) => this.toTarget(NavTargetKind.Category, c))

        return { component, technologies, categories, scenarios }
    }

    // The scenarios `entityId` participates in: every `scenario` entity whose
    // flow (sequences → steps → src/dst) names this id as a participant. Ordered
    // by declaration order; label from the scenario's `label` field, else its id.
    private scenarioTargets(model: ArchModel, entityId: string): NavTarget[]
    {
        const out: NavTarget[] = []
        for (const entity of model.entities()) {
            if (entity.concept !== SCENARIO_CONCEPT) continue
            const { participants } = collectScenarioFlow(entity as unknown as FlowEntity)
            if (!participants.includes(entityId)) continue
            const label = String(entity.field('label') ?? entity.id)
            out.push({ kind: NavTargetKind.Scenario, id: entity.id, concept: entity.concept, label })
        }
        return out
    }

    // The category Elements for a node: itself (category node), its
    // `applicable_to` (technology node), or its direct `category` (component) —
    // falling back to the implementing technology's `applicable_to` when a
    // component declares no category of its own.
    private categoryElements(concept: string, el: Element, techEls: readonly Element[]): readonly Element[]
    {
        if (concept === CATEGORY_CONCEPT) return [el]
        if (concept === TECHNOLOGY) return el.refs[APPLICABLE_TO] ?? []
        const direct = el.refs[CATEGORY] ?? []
        if (direct.length > 0) return direct
        return techEls[0]?.refs[APPLICABLE_TO] ?? []
    }

    private toTarget(kind: NavTargetKind, el: Element): NavTarget
    {
        const label = String(el.fields['label'] ?? el.fields['name'] ?? el.id)
        return { kind, id: el.id, concept: el.concept, label }
    }

    // Navigate to a resolved target: reveal published entities in the Libraries
    // panel, else open the declaring .todl source at the entity's declaration.
    public async navigateTo(model: ArchModel, projectId: string, target: NavTarget): Promise<void>
    {
        const origin = model.wikiOriginOf(target.id)
        if (origin?.kind === WikiOriginKind.Package) {
            this.activateLibraries()
            this.resolveLibraries()?.RevealTerm(target.id)
            return
        }
        // Open-project entity: own instances have a home file; a project-local term
        // (rare — technologies/categories usually come from published libraries)
        // has no home and is a v1 no-op with a status left to the panel.
        const uri = model.homeOf(target.id)
        if (uri === undefined) return
        const line = await this.lineOfDeclaration(model, uri, target.id)
        await this.resolveExplorer()?.OpenFileInProject(projectId, uri, line, 1)
    }

    // 1-based line of the entity's declaration in its source; 1 when not found.
    // Matches a declaration line: the concept keyword plus the entity's local id.
    private async lineOfDeclaration(model: ArchModel, uri: string, id: string): Promise<number>
    {
        const text = await model.Storage.ReadText(uri)
        const lines = text.split('\n')
        const localId = id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id
        const idRe = new RegExp(`\\b${localId}\\b`)
        const declRe = /\b(component|technology|category|actor|block|location|term|scenario)\b/
        const idx = lines.findIndex((ln) => idRe.test(ln) && declRe.test(ln))
        return idx >= 0 ? idx + 1 : 1
    }

    private explorer?: IExplorer
    private libraries?: ILibraries

    protected resolveExplorer(): IExplorer | undefined
    {
        return this.explorer ??= this.provider.get(ProjectExplorerService.Key)
    }

    protected resolveLibraries(): ILibraries | undefined
    {
        return this.libraries ??= this.provider.get(LibrariesPanelService.Key)
    }

    // Make the Libraries capability the visible side pane: find its navigation
    // destination (by capability ServiceKey) and execute its ActivateCommand.
    protected activateLibraries(): void
    {
        const nav = this.provider.get(NavigationService.Key)
        if (nav === undefined) return
        for (const item of nav.Items) {
            const dest = item as NavigationDestination
            if (dest.Capability?.ServiceKey === LibrariesPanelService.Key) {
                nav.SidePaneVisible = true
                dest.ActivateCommand?.Execute(undefined)
                return
            }
        }
    }

    // The composed Element for an entity id. Resolves the model's own instance by
    // id (else the repo node), then flattens it via toElement so `.refs` carry
    // resolved referents. Overridden in tests with hand-built Elements.
    protected elementFor(model: ArchModel, id: string): Element | undefined
    {
        const repo: Repository = model.repository()
        const entity: Entity | undefined =
            model.entities().find((e) => e.id === id) ?? (repo.resolve(id) as Entity | undefined)
        if (entity === undefined) return undefined
        return toElement(repo, entity, { homeOf: (x) => model.homeOf(x) })
    }
}
