import { MetaKind, type Entity, type Repository } from '@pragmatic-tech-ai/todl'

// Diagram containment metadata, derived from the meta-model. A containment
// relationship's refs project as visual NESTING (a child node inside a container
// node) instead of a connector; the ref lives on the CONTAINED entity and points
// at its container (`component --in--> location`). Both facts are read from the
// prelude annotations (`@has_children`, `@containment`) with sensible defaults so a
// meta-model that only names its member `in` needs no annotations at all.

// The default containment member name: a relationship called `in` is containment
// unless annotated otherwise.
export const CONTAINMENT_MEMBER_DEFAULT = 'in'

// A relationship member is a containment member when `<concept>.<member>` carries
// the `@containment` annotation OR (the default) its name is `in`.
export function isContainmentRelationship(repo: Repository, concept: string, member: string): boolean
{
    if (repo.resolve(`${concept}.${member}@containment`) !== undefined) return true
    return member === CONTAINMENT_MEMBER_DEFAULT
}

// Every concept declared in the repo (meta-kind `concept`).
function allConcepts(repo: Repository): string[]
{
    return repo.allNodes().filter((n) => n.typeOf === MetaKind.Concept).map((n) => n.id)
}

// The set of concepts that are the target of some containment relationship
// anywhere in the meta-model — i.e. the concepts that hold children by default.
// Cached per repository (the meta-model is immutable for a binding's lifetime).
const _targetCache = new WeakMap<Repository, Set<string>>()
function containmentTargets(repo: Repository): Set<string>
{
    const cached = _targetCache.get(repo)
    if (cached !== undefined) return cached
    const set = new Set<string>()
    for (const concept of allConcepts(repo))
        for (const rel of repo.effectiveSchema(concept).relationships)
            if (isContainmentRelationship(repo, concept, rel.name))
                for (const t of rel.targets) set.add(t)
    _targetCache.set(repo, set)
    return set
}

// A concept renders as a container when it carries the `@has_children` annotation
// OR (the default) it is the target of some containment relationship.
export function isContainerConcept(repo: Repository, concept: string): boolean
{
    if (repo.resolve(`${concept}@has_children`) !== undefined) return true
    return containmentTargets(repo).has(concept)
}

// The container an entity currently sits in: the first placed target of its first
// containment relationship. undefined when it has no containment ref (top level).
export function containmentParentOf(repo: Repository, entity: Entity): Entity | undefined
{
    for (const rel of entity.schema().relationships) {
        if (!isContainmentRelationship(repo, entity.concept, rel.name)) continue
        const targets = entity.refs(rel.name)
        if (targets.length > 0) return targets[0]
    }
    return undefined
}

// The forward "membership" field on a container concept that lists children of the
// given child concept — e.g. `block.components : component[]`. This is the PARENT-
// side face of containment; the child-side face is the @containment relationship
// read by containmentParentOf. Returns the field name, or undefined when the
// container declares no list typed to the child. A reference-typed field carries
// the child concept as its `type`; a scalar field (id, label) never matches a
// concept id, so those are naturally skipped.
export function membershipFieldFor(repo: Repository, containerConcept: string, childConcept: string): string | undefined
{
    const childTypes = new Set<string>([childConcept, ...repo.supertypesOf(childConcept)])
    for (const f of repo.effectiveSchema(containerConcept).fields)
        if (childTypes.has(f.type)) return f.name
    return undefined
}

// The children a container entity declares via its forward membership fields
// (e.g. a block's `components`). Reads every reference-typed field: a scalar field
// (id, label) yields no refs, and an `in`-style up-ref is a relationship (not a
// field), so both are naturally excluded. Used to materialize a container's full
// membership when it is placed on the diagram.
export function membershipChildrenOf(repo: Repository, container: Entity): Entity[]
{
    const out: Entity[] = []
    for (const f of repo.effectiveSchema(container.concept).fields)
        out.push(...container.refs(f.name))
    return out
}

// The container an entity sits in, resolving BOTH containment channels:
//   (a) the child's own @containment up-ref (`in_block`) — the canonical form,
//       read by containmentParentOf; and
//   (b) the forward face — a container that LISTS this entity in a membership field
//       (`block.components`), found via reverse navigation (`referrers`).
// (a) wins when both are present. The membership-field predicate also excludes an
// `in`-style referrer (a CHILD pointing up via a relationship, not a field), so a
// location is never mistaken for being contained in its own blocks. undefined when
// the entity is top-level.
export function containingContainerOf(repo: Repository, entity: Entity): Entity | undefined
{
    const own = containmentParentOf(repo, entity)
    if (own !== undefined) return own
    for (const referrer of entity.referrers())
        if (membershipFieldFor(repo, referrer.concept, entity.concept) !== undefined) return referrer
    return undefined
}

// The containment member name for a concept — the first containment relationship
// on its schema, or the default `in`. The write-back path uses this to addRef /
// removeRef the right member when a node is nested / un-nested.
export function containmentMemberOf(repo: Repository, concept: string): string
{
    for (const rel of repo.effectiveSchema(concept).relationships)
        if (isContainmentRelationship(repo, concept, rel.name)) return rel.name
    return CONTAINMENT_MEMBER_DEFAULT
}

// The containment member on `childConcept` that may point at `parentConcept` (or a
// supertype of it), or undefined when the meta-model permits no such nesting. A
// defined result is the legality proof AND the member to write: nesting is legal
// iff this returns a member. The write-back path rejects a nest that returns
// undefined (no relationship can hold it).
export function containmentMemberFor(repo: Repository, childConcept: string, parentConcept: string): string | undefined
{
    const parentTypes = new Set<string>([parentConcept, ...repo.supertypesOf(parentConcept)])
    for (const rel of repo.effectiveSchema(childConcept).relationships) {
        if (!isContainmentRelationship(repo, childConcept, rel.name)) continue
        if (rel.targets.some((t) => parentTypes.has(t))) return rel.name
    }
    return undefined
}
