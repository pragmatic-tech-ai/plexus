import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { Repository } from '@pragmatic-tech-ai/todl'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { humanize } from './arch-default-label.js'
import { conceptTypeOf, acceptSet } from './arch-concept-type.js'
import { materializeRoots } from './arch-materialize.js'

// A dropped container-concept term (a location / block / subscription / …) that
// this diagram's viewpoint does not frame can't be placed here, and the drop
// resolver's facet-drop fallback would otherwise silently mint a DIFFERENT
// concept (e.g. a component `in` the dropped location). The resolver returns a
// Rejected action for that case; these helpers turn it into a comprehensive,
// actionable message so the drop is interrupted with an explanation, never a
// surprise. Kept separate from the (pure) resolver so it can carry the label +
// dialog dependencies.

// The concept a facet-drop would have created from this term here: the first
// materialize root with a reference member that accepts the term's type, and the
// member it would fill. undefined when nothing would have matched (a plain no-op).
function fallbackTarget(repo: Repository, ct: string): { concept: string; member: string } | undefined
{
    const accept = acceptSet(repo, ct)
    for (const root of materializeRoots(repo))
        for (const rel of repo.effectiveSchema(root).relationships)
            if (rel.targets.some((t) => accept.has(t)))
                return { concept: root, member: rel.name }
    return undefined
}

// The term's display label: its own `label` if set, else a humanized id.
function termLabel(repo: Repository, termId: string): string
{
    const lbl = repo.resolve(termId)?.attrs.get('label')
    return typeof lbl === 'string' && lbl.length > 0 ? lbl : humanize(termId)
}

// Build the title + body for the rejected-drop modal. Pure (repo-only) so it is
// unit-testable. `scope` is the diagram's selected viewpoint set.
export function dropRejectionMessage(repo: Repository, termId: string, scope: ReadonlySet<string>): { title: string; message: string }
{
    const ct = conceptTypeOf(repo, termId)
    const label = termLabel(repo, termId)
    const here = [...scope]
    const framing = repo.viewpointsFraming(ct)
    const fallback = fallbackTarget(repo, ct)

    const hereList = here.length > 0 ? here.join(', ') : '(none)'
    const whatWouldHappen = fallback !== undefined
        ? ` Dropping it here would instead create a ${fallback.concept} (its "${fallback.member}" pointing at "${label}") — which isn't what you dropped, so the drop was cancelled.`
        : ' The drop was cancelled.'
    const howToFix = framing.length > 0
        ? `To place a ${ct} on a diagram, change this diagram's viewpoint to one that includes ${ct} — ${framing.join(', ')} — using the viewpoints selector, then drop it again.`
        : `No viewpoint in this model frames ${ct}, so it cannot be placed on any diagram.`

    return {
        title: `Can't place "${label}" here`,
        message: `"${label}" is a ${ct}, but this diagram's viewpoint (${hereList}) doesn't include ${ct}.${whatWouldHappen}\n\n${howToFix}`,
    }
}

// Show the rejected-drop modal (informational, single OK). No-op without a
// DialogService (headless / tests).
export function showDropRejected(dialogs: DialogService | undefined, repo: Repository, termId: string, scope: ReadonlySet<string>): void
{
    if (dialogs === undefined) return
    const { title, message } = dropRejectionMessage(repo, termId, scope)
    const vm = new ConfirmDialogModel(message, 'OK', () => dialogs.Close(true))
    void dialogs.Show<boolean>({ Title: title, Content: vm, Width: 460 })
}
