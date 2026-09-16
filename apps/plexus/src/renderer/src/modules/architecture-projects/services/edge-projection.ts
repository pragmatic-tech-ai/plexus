import type { Entity, Repository } from '@pragmatic-tech-ai/todl'
import { isContainmentRelationship } from './containment.js'
import { isConnectorEntity, connectorTypeOf, CONNECTOR_FROM_MEMBER, CONNECTOR_TO_MEMBER } from './connector-entity.js'

// A stable, unique key for a projected connector: one per (from, member, to).
// Multi-member relationships between the same pair yield distinct keys.
export function edgeKey(from: string, member: string, to: string): string {
    return `${from}|${member}|${to}`
}

// Synthetic member marking a projected edge derived from a `connector` ENTITY
// (vs a concept relationship or scenario step). The entity id is encoded after
// the colon so the key is unique per connector and delete can map back to it.
export const CONNECTOR_ENTITY_MEMBER_PREFIX = '__connector_entity__'

// The connector entity id behind a projected edge key, or undefined when the key
// is not a connector-entity edge (a relationship / scenario-step edge).
export function connectorEntityIdOf(key: string): string | undefined {
    const member = key.split('|')[1]
    const tag = `${CONNECTOR_ENTITY_MEMBER_PREFIX}:`
    return member?.startsWith(tag) ? member.slice(tag.length) : undefined
}

// A LOAD-STABLE key for persisting a projected edge's saved visual (route / ports).
// A relationship / scenario-step edge key is already stable and used verbatim. A
// connector-ENTITY edge key embeds the entity's synthetic id, which regenerates on
// every load (edge-record `a --> b` mints a fresh id), so a visual keyed by it can
// never be matched back after a reopen — the whole reroute is lost. Re-key those by
// the (from, type, to) identity, which the source determines and a reload preserves.
export function connectorVisualKey(key: string, type: string): string {
    if (connectorEntityIdOf(key) === undefined) return key
    const [from, , to] = key.split('|')
    return edgeKey(from, `${CONNECTOR_ENTITY_MEMBER_PREFIX}:${type}`, to)
}

// Desired edges from standalone `connector` entities: for each own connector
// entity whose `from` and `to` both resolve to placed, in-scope nodes, one edge
// keyed by the entity id. Returns edgeKey → the connector's type term (its label).
export function desiredConnectorEntityEdges(
    repo: Repository,
    ownEntities: readonly Entity[],
    placed: ReadonlySet<string>,
    scope: ReadonlySet<string>,
): Map<string, string> {
    const out = new Map<string, string>()
    const inScope = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    for (const e of ownEntities) {
        if (!isConnectorEntity(repo, e)) continue
        const from = e.ref(CONNECTOR_FROM_MEMBER)
        const to = e.ref(CONNECTOR_TO_MEMBER)
        if (from === undefined || to === undefined) continue
        if (!placed.has(from.id) || !placed.has(to.id)) continue
        if (!inScope(from.concept) || !inScope(to.concept)) continue
        out.set(edgeKey(from.id, `${CONNECTOR_ENTITY_MEMBER_PREFIX}:${e.id}`, to.id), connectorTypeOf(e))
    }
    return out
}

// The set of desired projected edges for a placed-node set: for each placed
// entity, each relationship member's targets that are ALSO placed and whose
// concept is framed by the scope. Returns `edgeKey` strings.
export function desiredEdges(
    repo: Repository,
    placed: ReadonlyMap<string, Entity>,
    scope: ReadonlySet<string>,
): Set<string> {
    const out = new Set<string>()
    const inScope = (concept: string): boolean =>
        repo.viewpointsFraming(concept).some((v) => scope.has(v))
    for (const [fromId, e] of placed) {
        for (const rel of repo.effectiveSchema(e.concept).relationships) {
            if (isContainmentRelationship(repo, e.concept, rel.name)) continue   // nests, not a connector
            for (const target of e.refs(rel.name)) {
                if (!placed.has(target.id)) continue
                if (!inScope(target.concept)) continue
                out.add(edgeKey(fromId, rel.name, target.id))
            }
        }
    }
    return out
}
