import type { Entity, Repository } from '@pragmatic-tech-ai/todl'
import type { ArchModel } from './arch-model.js'
import { acceptSet } from './arch-concept-type.js'

// The tech-architecture meta-model models a typed edge between two nodes as a
// first-class `connector` ENTITY: `connector <id> { type = "calls"; from = A;
// to = B; }`. The `type` is a `connectors`-taxonomy term (the taxonomy
// `represents connector`), stored as a plain scalar attr — read via
// `entity.field('type')`, NOT a classification (`entity.is('calls')` is false).
export const CONNECTOR_CONCEPT = 'connector'
export const CONNECTOR_TYPE_FIELD = 'type'
export const CONNECTOR_FROM_MEMBER = 'from'
export const CONNECTOR_TO_MEMBER = 'to'
// The meta-model's shorthand default (connector.todl: "Two-element list,
// shorthand for `type: calls`").
export const CONNECTOR_DEFAULT_TYPE = 'calls'
// Synthetic action member identifying the "mint a connector entity" outcome in a
// draw chooser (distinct from any real relationship member name).
export const CONNECTOR_DRAW_MEMBER = '__connector_draw__'

// True when an entity is (or subtypes) the `connector` concept.
export function isConnectorEntity(repo: Repository, entity: Entity): boolean {
    return acceptSet(repo, entity.concept).has(CONNECTOR_CONCEPT)
}

// A connector entity's type term (e.g. 'calls'), or the default when unset.
export function connectorTypeOf(entity: Entity): string {
    const t = entity.field(CONNECTOR_TYPE_FIELD)
    return typeof t === 'string' && t.length > 0 ? t : CONNECTOR_DEFAULT_TYPE
}

// True when the meta-model's `connector` `from`/`to` accept the (src → tgt) pair
// (subtype-aware) — i.e. drawing a line between two nodes of these concepts can
// mint a connector entity. False when the meta-model has no `connector` concept.
export function canDrawConnectorEntity(repo: Repository, srcConcept: string, tgtConcept: string): boolean {
    if (repo.resolve(CONNECTOR_CONCEPT) === undefined) return false
    const rels = repo.effectiveSchema(CONNECTOR_CONCEPT).relationships
    const fromRel = rels.find((r) => r.name === CONNECTOR_FROM_MEMBER)
    const toRel = rels.find((r) => r.name === CONNECTOR_TO_MEMBER)
    if (fromRel === undefined || toRel === undefined) return false
    const accepts = (targets: readonly string[], concept: string): boolean => {
        const accept = acceptSet(repo, concept)
        return targets.some((t) => accept.has(t))
    }
    return accepts(fromRel.targets, srcConcept) && accepts(toRel.targets, tgtConcept)
}

// Mint a `connector` entity linking `fromId → toId` with the given type term.
// Routes it to the `from` endpoint's home file so it round-trips to real source.
// Returns the new entity id. Does NOT save — the caller saves once.
export function mintConnectorEntity(model: ArchModel, fromId: string, toId: string, type: string): string {
    const id = model.uniqueId(CONNECTOR_CONCEPT)
    model.create(CONNECTOR_CONCEPT, id, model.homeOf(fromId))
    model.addRef(id, CONNECTOR_FROM_MEMBER, fromId)
    model.addRef(id, CONNECTOR_TO_MEMBER, toId)
    model.setField(id, CONNECTOR_TYPE_FIELD, type)
    return id
}
