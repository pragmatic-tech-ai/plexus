// Test-only helpers for hand-building TODL `JsonNode` / `TodlDocument` fixtures.
//
// todl 0.33.x's `JsonNode` is a wide, strict shape (id, tier, type, metaKind,
// namespace, localId, isClass, class, storageId, fields, attrs). Tests only ever
// care about a handful of those fields, so `jsonNode()` takes just the relevant
// ones and fills the rest with the emitter's defaults — keeping fixtures concise
// AND type-clean. `metaKind` is accepted as a plain string (the ontology kind,
// e.g. 'concept'/'taxonomy'/'term') and cast to the enum, since fixtures spell
// the value literally.
import type { JsonNode, JsonEdge, TodlDocument, Scalar } from '@pragmatic-tech-ai/todl'

interface NodeSpec
{
    id: string
    tier: string
    type?: string | null
    metaKind?: string | null
    namespace?: string | null
    localId?: string | null
    isClass?: boolean
    class?: string | null
    storageId?: string | null
    attrs?: Record<string, Scalar>
}

// Build a full JsonNode from the fields a fixture cares about, defaulting the
// rest (namespace/class/storageId/fields/attrs) to the emitter's empties.
export function jsonNode(spec: NodeSpec): JsonNode
{
    return {
        id: spec.id,
        tier: spec.tier,
        type: spec.type ?? null,
        metaKind: (spec.metaKind ?? null) as JsonNode['metaKind'],
        namespace: spec.namespace ?? null,
        localId: spec.localId ?? null,
        isClass: spec.isClass ?? false,
        class: spec.class ?? null,
        storageId: spec.storageId ?? null,
        fields: [],
        attrs: spec.attrs ?? {},
    }
}

// Build a TodlDocument from node specs + optional edges.
export function todlDoc(nodes: NodeSpec[], edges: JsonEdge[] = []): TodlDocument
{
    return { nodes: nodes.map(jsonNode), edges }
}
