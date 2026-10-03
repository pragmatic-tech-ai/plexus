import type { IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import type { IBagPersister, Solution } from '@pragmatic-tech-ai/todl'
import type { Hierarchy, HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'

// The persisted per-solution tree view state. All three fields are canonical names.
interface TreeState
{
    expanded: string[]
    selection: string[]
    anchor: string
}

// The in-memory restore intent, consumed as each name is applied (one-shot). Names live in sets
// so a name is applied exactly once — the first time its row is realized — and never re-applied
// when the user later collapses and re-expands the same subtree.
interface RestoreState
{
    expanded: Set<string>
    selection: Set<string>
    anchor: string
}

// The per-item bookkeeping this service holds: the disposer for the item's own subscriptions,
// plus the set of child items it is currently tracking (so they can be untracked when they leave).
interface TrackRecord
{
    dispose: () => void
    children: Set<HierarchyItem>
}

// Persists and reactively restores the Solution Explorer tree's expansion and selection, per
// solution, via the global durable bag store keyed by the solution's on-disk path. User-local
// view state: never committed. An untitled solution (no Storage) is held in memory for the
// session only. Writes go to the in-memory bag synchronously; the durable store debounces the
// actual disk write.
//
// Canonical names are item-based now (HierarchyItem.CanonicalName → Hierarchy.CanonicalNameOf),
// and a one-off reveal of a persisted path goes through Hierarchy.Reveal (which realizes +
// expands the hops down to it). Restore is one-shot: the persisted state is a seed applied as
// rows realize (the file subtrees arrive asynchronously), not a standing rule — once a name is
// applied it is consumed, so a manual collapse/deselect is never undone within the session. A
// persisted name whose row never realizes (a stale / pruned path) is simply never consumed —
// discarded gracefully, never a crash. Tracking follows the live tree: items that leave
// (collapse, member removal) have their subscriptions released, so churn does not leak disposers.
export class SolutionTreeStateService
{
    private static readonly Kind = 'solution-tree-state'
    private static readonly ExpandedProp = 'expanded'
    private static readonly SelectionProp = 'selection'
    private static readonly AnchorProp = 'anchor'
    private static readonly IsExpandedProp = 'IsExpanded'

    // ObservableCollection.Subscribe and Observable.PropertyChanged().subscribe return different
    // disposal shapes (a bare function vs a Disposable); both are normalised to () => void here.
    private readonly subs: Array<() => void> = []
    private readonly itemSubs = new Map<HierarchyItem, TrackRecord>()
    private readonly rootSet = new Set<HierarchyItem>()
    // Re-entrant restore guard: a restore OnExpand() can realize a child that is itself restored,
    // nesting withRestoring. A counter (not a boolean) keeps save() suppressed until the whole
    // cascade unwinds, so no partial state is ever persisted mid-restore.
    private restoringDepth = 0
    private disposed = false
    private sessionState: TreeState | undefined   // untitled fallback
    private restoreState: RestoreState | undefined
    private readonly selectedItems: HierarchyItem[] = []
    private anchorItem: HierarchyItem | undefined

    constructor(
        private readonly hierarchy: Hierarchy,
        private readonly solution: Solution,
        private readonly bags: IBagPersister,
    )
    {
    }

    // Count of items currently tracked for view-state changes. Read-only diagnostic: lets a test
    // assert that expand/collapse churn does not retain disposers for items that left the tree.
    public get TrackedItemCount(): number { return this.itemSubs.size }

    public Start(): void
    {
        const state = this.readState()
        this.restoreState = { expanded: new Set(state.expanded), selection: new Set(state.selection), anchor: state.anchor }
        this.watch()
    }

    // Reveal (realize + expand the hops down to) a persisted canonical path and select it. A
    // stale / pruned path yields undefined (Hierarchy.Reveal found no such row) and is discarded
    // gracefully. The one-off counterpart to the reactive seed restore below.
    public Reveal(canonicalName: string): HierarchyItem | undefined
    {
        const item = this.hierarchy.Reveal(canonicalName)
        if (item === undefined) return undefined
        this.hierarchy.SelectSingle(item)
        return item
    }

    public dispose(): void
    {
        this.disposed = true
        for (const s of this.subs) s()
        for (const r of this.itemSubs.values()) r.dispose()
        this.subs.length = 0
        this.itemSubs.clear()
        this.rootSet.clear()
    }

    private watch(): void
    {
        this.subs.push(this.hierarchy.Selection.Subscribe(() => this.save()))
        this.subs.push(this.hierarchy.Roots.Subscribe(() => this.syncRoots()))
        this.syncRoots()
    }

    // Reconcile the tracked root set against the live roots: track roots that appeared, untrack
    // roots that left (a solution swap or root replacement never leaves stale subscriptions).
    private syncRoots(): void
    {
        const live = new Set(this.hierarchy.Roots.ToArray())
        for (const item of this.rootSet)
        {
            if (!live.has(item)) { this.untrack(item); this.rootSet.delete(item) }
        }
        for (const item of live)
        {
            if (this.rootSet.has(item)) continue
            this.rootSet.add(item)
            this.track(item)
        }
    }

    private track(item: HierarchyItem): void
    {
        if (this.itemSubs.has(item)) return
        const record: TrackRecord = { dispose: () => {}, children: new Set() }
        const expansionSub = item.PropertyChanged(SolutionTreeStateService.IsExpandedProp).subscribe(() => this.save())
        const childrenSub = item.Children.Subscribe(() => this.reconcileChildren(item, record))
        record.dispose = () => { expansionSub.dispose(); childrenSub() }
        this.itemSubs.set(item, record)
        this.applyRestore(item)
        this.reconcileChildren(item, record)
    }

    // Track newly appeared children and untrack ones that left, keeping the record in step with
    // the item's live Children. Called on every Children mutation (realize, collapse, delta).
    private reconcileChildren(item: HierarchyItem, record: TrackRecord): void
    {
        const live = new Set(item.Children.ToArray())
        for (const child of record.children)
        {
            if (!live.has(child)) { this.untrack(child); record.children.delete(child) }
        }
        for (const child of live)
        {
            if (record.children.has(child)) continue
            record.children.add(child)
            this.track(child)
        }
    }

    // Release an item's subscriptions and, recursively, those of every child it was tracking.
    private untrack(item: HierarchyItem): void
    {
        const record = this.itemSubs.get(item)
        if (record === undefined) return
        this.itemSubs.delete(item)
        record.dispose()
        for (const child of record.children) this.untrack(child)
        record.children.clear()
    }

    // Apply the persisted seed to an item as it appears, consuming each name so it applies once.
    // Selection first, so a row that is both selected and expanded is selected before OnExpand()
    // cascades child tracking. When the seed is fully drained it is dropped entirely.
    private applyRestore(item: HierarchyItem): void
    {
        const state = this.restoreState
        if (state === undefined) return
        const name = item.CanonicalName
        if (name === '') return
        if (state.selection.has(name))
        {
            state.selection.delete(name)
            this.selectedItems.push(item)
            if (name === state.anchor) this.anchorItem = item
            this.withRestoring(() => this.hierarchy.SyncSelection(this.selectedItems, this.anchorItem ?? this.selectedItems[this.selectedItems.length - 1]))
        }
        if (state.expanded.has(name))
        {
            state.expanded.delete(name)
            this.withRestoring(() => item.OnExpand())
        }
        if (state.selection.size === 0 && state.expanded.size === 0) this.restoreState = undefined
    }

    private withRestoring(action: () => void): void
    {
        this.restoringDepth++
        try { action() }
        finally { this.restoringDepth-- }
    }

    private save(): void
    {
        if (this.restoringDepth > 0 || this.disposed) return
        const expanded: string[] = []
        this.collectExpanded(this.hierarchy.Roots.ToArray(), expanded)
        const selected = this.hierarchy.Selection.ToArray()
        const selection = selected.map((item: HierarchyItem) => item.CanonicalName).filter((n) => n !== '')
        // Hierarchy assigns Anchor AFTER the Selection mutation that fires this save, so during a
        // SelectSingle/SyncSelection it is momentarily stale (undefined). Fall back to the
        // last-selected row — exact for single-select, a sound pivot for multi-select.
        const anchor = (this.hierarchy.Anchor ?? selected[selected.length - 1])?.CanonicalName ?? ''
        this.writeState({ expanded, selection, anchor })
    }

    private collectExpanded(items: readonly HierarchyItem[], out: string[]): void
    {
        for (const item of items)
        {
            if (!item.IsExpanded) continue
            const name = item.CanonicalName
            if (name !== '') out.push(name)
            this.collectExpanded(item.Children.ToArray(), out)
        }
    }

    private writeState(state: TreeState): void
    {
        if (!this.solution.HasLocation) { this.sessionState = state; return }
        const bag = this.bag()
        bag.SetValue(SolutionTreeStateService.ExpandedProp, state.expanded)
        bag.SetValue(SolutionTreeStateService.SelectionProp, state.selection)
        bag.SetValue(SolutionTreeStateService.AnchorProp, state.anchor)
    }

    private readState(): TreeState
    {
        if (!this.solution.HasLocation) return this.sessionState ?? { expanded: [], selection: [], anchor: '' }
        const bag = this.bag()
        const anchor = bag.GetValue(SolutionTreeStateService.AnchorProp)
        return {
            expanded: SolutionTreeStateService.asStrings(bag.GetValue(SolutionTreeStateService.ExpandedProp)),
            selection: SolutionTreeStateService.asStrings(bag.GetValue(SolutionTreeStateService.SelectionProp)),
            anchor: typeof anchor === 'string' ? anchor : '',
        }
    }

    private static asStrings(raw: unknown): string[]
    {
        return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
    }

    private bag(): IPropertyBag
    {
        return this.bags.Bag(SolutionTreeStateService.Kind, this.key())
    }

    private key(): string
    {
        return this.solution.Storage?.Root ?? ''
    }
}
