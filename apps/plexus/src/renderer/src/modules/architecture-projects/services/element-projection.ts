import type { Cardinality, Entity, Repository, Scalar } from '@pragmatic-tech-ai/todl'

// Plexus-owned port of the Element projection TODL retired in 2f9976a ("retire the
// dead Element/toElement projection (replaced by Snapshot)"). TODL's replacement,
// Snapshot, is a SHALLOW projection over reflection InstanceMirrors (refs are id
// strings; no provenance.home, referredBy or presentation hint), so it cannot back
// the deep, resolved-refs shape the navigation service, selection bridge and element
// view-models read. This keeps that shape and its semantics verbatim.

/** A read-only, JSON-serializable projection of a model node. Referenced
 *  aggregates and linked elements are resolved inline (deep); a node already
 *  expanded upstream collapses to a `truncated` node (own facets, empty subtree). */
export interface Element
{
    id: string
    concept: string
    fields: Record<string, Scalar>
    refs: Record<string, Element[]>
    schema: ElementSchema
    provenance: Provenance
    presentation: PresentationHint
    referredBy?: IncomingRef[]
    truncated?: true
}

export interface ElementSchema
{
    concept: string
    extends: string | null
    fields: { name: string; type: string; cardinality: Cardinality }[]
    relationships: { name: string; targets: string[]; cardinality: Cardinality; inverse: string | null }[]
}

export interface Provenance
{
    home?: string
    conforms?: string
}

export interface IncomingRef
{
    id: string
    concept: string
    via: string
}

export interface PresentationHint
{
    label: string
    iconKey?: string | null
}

export interface ToElementOptions
{
    maxDepth?: number
    presentation?: (e: Entity, defaultLabel: string) => PresentationHint
    homeOf?: (id: string) => string | undefined
}

// Projects an Entity (and, recursively, everything it references) into an Element.
// Cycle-guarded: an entity already expanded on the current projection collapses to a
// `truncated` node. `maxDepth` cuts recursion without marking truncation.
export class ElementProjection
{
    private static readonly LabelField = 'label'
    private static readonly NameField = 'name'
    private static readonly ConformsAttr = 'conforms'

    private readonly repo: Repository
    private readonly options: ToElementOptions

    public constructor(repo: Repository, options: ToElementOptions = {})
    {
        this.repo = repo
        this.options = options
    }

    public Project(entity: Entity): Element
    {
        return this.Build(entity, new Set<string>(), 0, true)
    }

    private Build(e: Entity, seen: Set<string>, depth: number, isRoot: boolean): Element
    {
        const label = ElementProjection.DefaultLabel(e)
        const node: Element = {
            id: e.id,
            concept: e.concept,
            fields: ElementProjection.FieldsOf(e),
            refs: {},
            schema: ElementProjection.SchemaOf(e),
            provenance: this.ProvenanceOf(e),
            presentation: this.options.presentation !== undefined ? this.options.presentation(e, label) : { label },
        }
        if (isRoot) node.referredBy = ElementProjection.IncomingRefs(e)

        if (seen.has(e.id))
        {
            node.truncated = true
            return node
        }
        if (this.options.maxDepth !== undefined && depth >= this.options.maxDepth) return node

        seen.add(e.id)
        for (const rel of e.schema().relationships)
        {
            const targets = e.refs(rel.name)
            if (targets.length === 0) continue
            node.refs[rel.name] = targets.map((t) => this.Build(t, seen, depth + 1, false))
        }
        return node
    }

    private ProvenanceOf(e: Entity): Provenance
    {
        const out: Provenance = {}
        const conforms = this.repo.resolve(e.id)?.attrs.get(ElementProjection.ConformsAttr)
        if (typeof conforms === 'string') out.conforms = conforms
        const home = this.options.homeOf?.(e.id)
        if (home !== undefined) out.home = home
        return out
    }

    private static DefaultLabel(e: Entity): string
    {
        const v = e.field(ElementProjection.LabelField) ?? e.field(ElementProjection.NameField)
        return v !== undefined ? String(v) : e.id
    }

    private static FieldsOf(e: Entity): Record<string, Scalar>
    {
        const out: Record<string, Scalar> = {}
        for (const [k, v] of e.fields) out[k] = v
        return out
    }

    private static SchemaOf(e: Entity): ElementSchema
    {
        const s = e.schema()
        return {
            concept: s.concept,
            extends: s.extends,
            fields: s.fields.map((f) => ({ name: f.name, type: f.type, cardinality: f.cardinality })),
            relationships: s.relationships.map((r) => ({ name: r.name, targets: [...r.targets], cardinality: r.cardinality, inverse: r.inverse })),
        }
    }

    // Incoming edges: who references e, and via which member. Root-only.
    private static IncomingRefs(e: Entity): IncomingRef[]
    {
        const out: IncomingRef[] = []
        for (const r of e.referrers())
        {
            for (const rel of r.schema().relationships)
            {
                if (r.refs(rel.name).some((t) => t.id === e.id)) out.push({ id: r.id, concept: r.concept, via: rel.name })
            }
        }
        return out
    }
}
