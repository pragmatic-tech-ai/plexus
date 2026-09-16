import type { Entity, Repository, PresentationHint } from '@pragmatic-tech-ai/todl'
import { iconEntityKey } from './arch-icon.js'
import type { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'

// Resolves an element's presentation hint: the caller's default label, plus the
// icon resource key looked up through the same chain the canvas node resolver
// uses (iconEntityKey -> registry.iconKeyFor, with the mm: fallback). null when
// nothing is icon-bearing.
export function resolveElementPresentation(
    repo: Repository,
    registry: TodlPresentationRegistry,
    e: Entity,
    defaultLabel: string,
): PresentationHint
{
    const key = iconEntityKey(repo, e)
    const iconKey = key !== undefined
        ? (registry.iconKeyFor(key) ?? registry.iconKeyFor(`mm:${key}`) ?? null)
        : null
    return { label: defaultLabel, iconKey }
}
