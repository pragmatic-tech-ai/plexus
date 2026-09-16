import type { Repository } from '@pragmatic-tech-ai/todl'
import { acceptSet } from './arch-concept-type.js'

// One way a drawn connector A→B can bind: the relationship member on A's concept
// to set. `label` is the chooser row text.
export interface ConnectorAction
{
    member: string
    label: string
}

// Candidate relationship members for a connector from `sourceConcept` to
// `targetConcept`: members on the source whose declared targets accept the target
// concept (subtype-aware), with the source concept framed by the scope. Empty ⇒
// reject; one ⇒ auto; many ⇒ chooser. Mirrors resolveDropActions.
export function resolveConnectorActions(
    repo: Repository,
    sourceConcept: string,
    targetConcept: string,
    scope: ReadonlySet<string>,
): ConnectorAction[]
{
    if (!repo.viewpointsFraming(sourceConcept).some((v) => scope.has(v))) return []
    const accept = acceptSet(repo, targetConcept)   // targetConcept ∪ its supertypes
    const out: ConnectorAction[] = []
    for (const rel of repo.effectiveSchema(sourceConcept).relationships) {
        if (rel.targets.some((t) => accept.has(t))) {
            out.push({ member: rel.name, label: `${rel.name} → ${targetConcept}` })
        }
    }
    return out
}
