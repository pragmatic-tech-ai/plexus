import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import type { SkillListItemVm } from './skill-list-item.js'

// One section in the grouped Skills panel — an open project (headed by its folder
// name), or the shared "Global" / "Packaged" scopes. Immutable; a rescan rebuilds
// the group list. Empty groups are never constructed (the service omits them).
export class SkillGroupVm extends Observable {
    private readonly _header: string
    private readonly _items: SkillListItemVm[]

    constructor(header: string, items: SkillListItemVm[]) { super(); this._header = header; this._items = items }

    get Header(): string { return this._header }
    get Items(): readonly SkillListItemVm[] { return this._items }
    get Count(): number { return this._items.length }
}
