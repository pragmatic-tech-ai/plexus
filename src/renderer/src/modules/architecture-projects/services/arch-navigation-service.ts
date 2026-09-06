import { toElement, type Element, type Entity, type Repository } from '@pragmatic-tech-ai/todl'
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { ArchModel } from './arch-model.js'

// Which relation a nav target represents. String-backed so it can drive markup
// (menu labels) and read clearly in tests.
export enum NavTargetKind { Component = 'component', Technology = 'technology', Category = 'category' }

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
        if (el === undefined) return { technologies: [], categories: [] }

        const concept = el.concept
        const component = concept === COMPONENT ? this.toTarget(NavTargetKind.Component, el) : undefined

        const techEls: readonly Element[] = concept === TECHNOLOGY ? [el] : (el.refs[IMPLEMENTED_BY] ?? [])
        const technologies = techEls.map((t) => this.toTarget(NavTargetKind.Technology, t))

        const categories = this.categoryElements(concept, el, techEls)
            .map((c) => this.toTarget(NavTargetKind.Category, c))

        return { component, technologies, categories }
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
