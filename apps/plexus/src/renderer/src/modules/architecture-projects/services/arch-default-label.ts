import type { Repository } from '@pragmatic-tech-ai/todl'
import { DropActionKind, type DropAction } from './arch-drop-resolver.js'

// Title-case the last dotted segment of an id: `m365_copilot` -> `M365 Copilot`.
export function humanize(id: string): string
{
    const seg = id.split('.').pop() ?? id
    return seg.split(/[_-]/).filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

// A sensible default for a dropped entity's required `label`: the dropped term's
// own label if present, else a humanized form of the term id (Reference drop) or
// the instantiated concept (Instance drop).
export function defaultLabel(repo: Repository, action: DropAction): string
{
    if (action.kind === DropActionKind.Reference && action.term !== undefined) {
        const lbl = repo.resolve(action.term)?.attrs.get('label')
        if (typeof lbl === 'string' && lbl.length > 0) return lbl
        return humanize(action.term)
    }
    return humanize(action.concept)
}
