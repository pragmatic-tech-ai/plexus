import type { Entity, Repository } from '@pragmatic-tech-ai/todl'

// "Has an icon": the `<id>@icon` annotation node the meta-model/library SOURCE
// declares (`annotate icon { path = … }`) — keyed on the annotation's presence, not
// its publish-time `key` attr, because arch projects load their bases from source.
function hasIcon(repo: Repository, id: string): boolean {
    const path = repo.resolve(`${id}@icon`)?.attrs.get('path')
    return typeof path === 'string' && path.length > 0
}

// The entity key whose icon a bound canvas node should draw — an id the presentation
// registry's index (registry.iconKeyFor) maps to a baked resource key, the SAME index
// the toolbox tiles resolve through. Returns undefined when nothing carries an icon
// (→ the node falls back to its concept, i.e. the default glyph).
//
// DECLARATIVE path — when the concept's relationship members carry `iconSource`
// annotations (`relationship implementedBy -> technology { annotate iconSource { order = 1; } }`):
// the entity's OWN icon wins first; otherwise the icon-bearing target of the
// lowest-`order` iconSource member wins (ties by schema order); otherwise undefined.
// A concept with NO iconSource member falls back to the LEGACY heuristic below, so
// existing meta-models resolve exactly as before (zero migration).
//
// Note: `order` is read as a string — TODL has no Number value kind, so a numeric
// annotation literal stores verbatim — and coerced with Number().
export function iconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    // Own-id icon wins first — the most specific source. A placed taxonomy archetype
    // (e.g. `actors.internal` dropped as an actor node) carries `@icon` on the TERM
    // itself, reachable only by its own id, not via its type/concept or refs. Instance
    // ids don't carry `@icon`, so this is a no-op for them (they resolve below).
    if (hasIcon(repo, entity.id)) return entity.id

    const sources: { member: string; order: number; index: number }[] = []
    let index = 0
    for (const rel of entity.schema().relationships) {
        const raw = repo.resolve(`${entity.concept}.${rel.name}@iconSource`)?.attrs.get('order')
        const order = raw === undefined || raw === null ? NaN : Number(raw)
        if (Number.isFinite(order)) sources.push({ member: rel.name, order, index })
        index++
    }

    if (sources.length > 0) {
        const own = entity.type()?.id ?? entity.concept
        if (hasIcon(repo, own)) return own
        sources.sort((a, b) => a.order - b.order || a.index - b.index)
        for (const s of sources)
            for (const target of entity.refs(s.member))
                if (hasIcon(repo, target.id)) return target.id
        return undefined
    }

    return legacyIconEntityKey(repo, entity)
}

// LEGACY heuristic (unchanged behavior): a referenced icon-bearing term wins over the
// entity's own type; among SEVERAL, the winner is decided by PROPAGATION DIRECTION —
// a term that references another candidate (its propagation source) outranks it,
// reproducibly from the saved refs; ties (no propagation link) fall back to schema
// order. No icon-bearing reference → the own concept → undefined.
function legacyIconEntityKey(repo: Repository, entity: Entity): string | undefined
{
    const candidates: string[] = []
    for (const rel of entity.schema().relationships)
        for (const target of entity.refs(rel.name))
            if (hasIcon(repo, target.id)) candidates.push(target.id)

    if (candidates.length === 0) {
        const own = entity.type()?.id ?? entity.concept
        return hasIcon(repo, own) ? own : undefined
    }
    if (candidates.length === 1) return candidates[0]

    // Rank by propagation direction: term A outranks B when A references B.
    const set = new Set(candidates)
    const refsOf = (id: string): Set<string> => {
        const s = new Set<string>()
        for (const [, targets] of repo.effectiveRelationships(id))
            for (const t of targets) s.add(t)
        return s
    }
    const outDegree = (term: string): number => {
        const refs = refsOf(term)
        let n = 0
        for (const other of set) if (other !== term && refs.has(other)) n++
        return n
    }
    // Highest out-degree (most "source") wins; ties keep schema order (first seen).
    let winner = candidates[0]
    let best = outDegree(winner)
    for (const term of candidates.slice(1)) {
        const d = outDegree(term)
        if (d > best) { winner = term; best = d }
    }
    return winner
}
