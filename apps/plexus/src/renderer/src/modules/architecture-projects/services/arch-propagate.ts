import { type Repository } from '@pragmatic-tech-ai/todl'
import { conceptTypeOf, acceptSet } from './arch-concept-type.js'

export interface PropFill { member: string; term: string }

// After a term is wired into `primaryMember` of a freshly created `targetConcept`,
// back-fill the term's OWN references onto the concept's other still-empty members:
// for each ref value the term carries, if exactly one empty member accepts that
// value's type, fill it. Zero or several matches → skip (deterministic).
export function propagationFills(repo: Repository, targetConcept: string, termId: string, primaryMember: string): PropFill[]
{
    const rels = repo.effectiveSchema(targetConcept).relationships
    const filled = new Set<string>([primaryMember])
    const out: PropFill[] = []
    for (const [, targets] of repo.effectiveRelationships(termId)) {
        for (const tgt of targets) {
            const accept = acceptSet(repo, conceptTypeOf(repo, tgt))
            const matching = rels.filter((r) => !filled.has(r.name) && r.targets.some((t) => accept.has(t)))
            if (matching.length !== 1) continue
            out.push({ member: matching[0].name, term: tgt })
            filled.add(matching[0].name)
        }
    }
    return out
}
