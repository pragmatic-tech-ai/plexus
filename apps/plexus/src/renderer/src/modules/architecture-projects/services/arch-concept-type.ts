import { MetaKind, type Repository } from '@pragmatic-tech-ai/todl'

// The concept a node stands for: a concept stands for itself; otherwise the class
// it instantiates, else the concept its taxonomy represents, else its own typeOf.
// Mirrors the long-standing derivation the drop resolver uses for a dropped term.
export function conceptTypeOf(repo: Repository, id: string): string {
    const node = repo.resolve(id)
    if (node?.typeOf === MetaKind.Concept) return id
    const typeOf = node?.typeOf ?? id
    return repo.classOf(id) ?? repo.represents(typeOf)[0] ?? typeOf
}

// A concept id plus all its supertypes — the set of concept ids a reference
// member may declare as a target and still accept `conceptId`.
export function acceptSet(repo: Repository, conceptId: string): Set<string> {
    return new Set<string>([conceptId, ...repo.supertypesOf(conceptId)])
}
