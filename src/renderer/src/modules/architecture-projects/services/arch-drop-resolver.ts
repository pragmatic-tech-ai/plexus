import { MetaKind, type Repository } from '@pragmatic-tech-ai/todl'
import { conceptTypeOf, acceptSet } from './arch-concept-type.js'
import { materializeOf, materializeRoots } from './arch-materialize.js'
import { isContainerConcept } from './containment.js'

// What a term-drop can create: PLACE the dropped term's own entity (a container
// concept, e.g. a library location), a direct instance of a materialize root, an
// instance of a root X whose reference member m targets the dropped term's type,
// or REJECTED — the drop can't be honored on this diagram and must be interrupted
// with an explanation instead of silently producing a surprising node.
export enum DropActionKind { Place = 'place', Instance = 'instance', Reference = 'reference', Rejected = 'rejected' }

export interface DropAction
{
    kind: DropActionKind
    concept: string     // X — the concept to instantiate
    member?: string     // m — reference member (Reference only)
    term?: string       // t — the dropped term id (Reference only)
    label: string       // chooser row text
}

// Candidate drop-actions for a dropped toolbox term. `descriptorKey` is the term
// id (library) or 'mm:'+id (meta-model); `scope` is the diagram's viewpoint set.
// Empty ⇒ reject; one ⇒ auto; many ⇒ chooser. When the meta-model declares no
// materialize roots the legacy scan behavior is used unchanged.
export function resolveDropActions(repo: Repository, descriptorKey: string, scope: ReadonlySet<string>): DropAction[]
{
    const termId = descriptorKey.startsWith('mm:') ? descriptorKey.slice(3) : descriptorKey
    const node = repo.resolve(termId)
    if (node === undefined) return []

    const roots = materializeRoots(repo)
    if (roots.length === 0) return legacyResolveDropActions(repo, termId, scope)

    const ct = conceptTypeOf(repo, termId)
    const accept = acceptSet(repo, ct)
    const framed = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const isClassTerm = node.attrs.get('class') === true

    // 0. PLACE: the dropped term is itself a container-concept entity (e.g. a
    //    library location like `microsoft_tech.azure`). Place THAT entity as a
    //    container — the binding then reads its children (its `parent`/`in` chain)
    //    from the model — instead of referencing it from a materialize root (which
    //    would create a component `in` the location, never the location itself).
    //    Takes priority. Location terms are class-terms yet concrete placeable
    //    entities, so isContainerConcept (NOT the class flag) is the gate.
    if (isContainerConcept(repo, ct) && framed(ct))
        return [{ kind: DropActionKind.Place, concept: ct, term: termId, label: ct }]

    // 0b. REJECT: the dropped term IS a container concept (a placeable location /
    //     block / subscription / …) but this diagram's viewpoint does NOT frame it.
    //     Placing it here is illegal, and the facet-drop fallback (step 3) would
    //     silently mint a DIFFERENT concept — e.g. dropping a location `azure` on a
    //     Scenarios diagram would create a component whose `in` points at azure.
    //     That surprise is the bug; interrupt with an explanation instead. The
    //     factory turns this into a modal (it owns the dialog service + labels).
    if (isContainerConcept(repo, ct))
        return [{ kind: DropActionKind.Rejected, concept: ct, term: termId, label: ct }]

    // 0c. PLACE-LEAF: the dropped term is a class-term ARCHETYPE of a concept the
    //     meta-model marks as a drop concept (a materialize root) but that is NOT a
    //     container — place the archetype itself as a leaf node (bound to the term,
    //     with its icon + label), no model instance. This is how an actor archetype
    //     (`actors.internal`) drops an actor node: `actor` is annotated `materialize`
    //     so it is a root, yet its terms are class-terms (excluded from bare
    //     instantiation, step 1) and nothing references `actor` from a root — so
    //     without this branch the drop resolves to nothing. Gated on the concept
    //     being a root so ONLY meta-model-marked concepts place their archetypes; a
    //     blind "place any unreferenced archetype" rule would wrongly place
    //     `application-kind` / `lifecycle-stage` / … archetypes too. Container
    //     archetypes are handled above (0/0b), so this is the non-container case.
    if (isClassTerm && roots.includes(ct) && framed(ct))
        return [{ kind: DropActionKind.Place, concept: ct, term: termId, label: ct }]

    // 1. Direct: the term's own class (or a supertype) is a root → instantiate it.
    //    Class-terms are excluded — a bare instance would lose which term it is,
    //    so they route through a reference instead.
    const directRoot = [...accept].find((r) => roots.includes(r) && framed(r))
    if (directRoot !== undefined && !isClassTerm)
        return [{ kind: DropActionKind.Instance, concept: directRoot, label: directRoot }]

    // 2. Redirect override on the term, else on its facet concept.
    const spec = materializeOf(repo, termId) ?? materializeOf(repo, ct)
    if (spec?.concept !== undefined && framed(spec.concept)) {
        const member = spec.via ?? singleAcceptingMember(repo, spec.concept, accept)
        if (member !== undefined)
            return [{ kind: DropActionKind.Reference, concept: spec.concept, member, term: termId, label: `${spec.concept}  (${member})` }]
    }

    // 3. Facet drop: scan ROOTS ONLY (not every concept) for a member accepting ct.
    const actions: DropAction[] = []
    for (const r of roots) {
        if (!framed(r)) continue
        for (const rel of repo.effectiveSchema(r).relationships)
            if (rel.targets.some((t) => accept.has(t)))
                actions.push({ kind: DropActionKind.Reference, concept: r, member: rel.name, term: termId, label: `${r}  (${rel.name})` })
    }
    return actions
}

// The one relationship on `concept` whose targets accept `accept`, or undefined
// when zero or several match (ambiguous → caller falls through).
function singleAcceptingMember(repo: Repository, concept: string, accept: ReadonlySet<string>): string | undefined
{
    const matching = repo.effectiveSchema(concept).relationships.filter((rel) => rel.targets.some((t) => accept.has(t)))
    return matching.length === 1 ? matching[0].name : undefined
}

// Pre-materialize behavior, kept as the fallback for meta-models that declare no
// materialize roots: scan EVERY framed concept for a member targeting the term's
// class (plus a bare Instance when the class itself is framed).
function legacyResolveDropActions(repo: Repository, termId: string, scope: ReadonlySet<string>): DropAction[]
{
    const node = repo.resolve(termId)
    if (node === undefined) return []
    const ct = repo.classOf(termId) ?? repo.represents(node.typeOf)[0] ?? node.typeOf
    const accept = new Set<string>([ct, ...repo.supertypesOf(ct)])
    const framed = (concept: string): boolean => repo.viewpointsFraming(concept).some((v) => scope.has(v))
    const isClassTerm = node.attrs.get('class') === true

    const actions: DropAction[] = []
    if (!isClassTerm && framed(ct)) actions.push({ kind: DropActionKind.Instance, concept: ct, label: ct })

    for (const n of repo.allNodes()) {
        if (n.typeOf !== MetaKind.Concept) continue
        const x = n.id
        if (!framed(x)) continue
        for (const rel of repo.effectiveSchema(x).relationships) {
            if (rel.targets.some((t) => accept.has(t)))
                actions.push({ kind: DropActionKind.Reference, concept: x, member: rel.name, term: termId, label: `${x}  (${rel.name})` })
        }
    }
    return actions
}
