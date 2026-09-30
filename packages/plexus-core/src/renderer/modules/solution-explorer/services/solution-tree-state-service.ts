import type { IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import type { IBagPersister, Solution } from '@pragmatic-tech-ai/todl'
import type { HierarchyItemVM, HierarchyTreeVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'

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

// The per-VM bookkeeping this service holds: the disposer for the VM's own subscriptions, plus
// the set of child VMs it is currently tracking (so they can be untracked when they leave).
interface TrackRecord
{
    dispose: () => void
    children: Set<HierarchyItemVM>
}

// Persists and reactively restores the Solution Explorer tree's expansion and selection, per
// solution, via the global durable bag store keyed by the solution's on-disk path. User-local
// view state: never committed. An untitled solution (no Storage) is held in memory for the
// session only. Writes go to the in-memory bag synchronously; the durable store debounces the
// actual disk write.
//
// Restore is one-shot: the persisted state is a seed applied as rows realize, not a standing
// rule — once a name is applied it is consumed, so a manual collapse/deselect is never undone
// within the session. Tracking follows the live tree: VMs that leave (collapse, member removal)
// have their subscriptions released, so churn does not leak disposers.
export class SolutionTreeStateService
{
    private static readonly Kind = 'solution-tree-state'
    private static readonly ExpandedProp = 'expanded'
    private static readonly SelectionProp = 'selection'
    private static readonly AnchorProp = 'anchor'

    // ObservableCollection.Subscribe and Observable.PropertyChanged().subscribe return different
    // disposal shapes (a bare function vs a Disposable); both are normalised to () => void here.
    private readonly subs: Array<() => void> = []
    private readonly vmSubs = new Map<HierarchyItemVM, TrackRecord>()
    private readonly rootSet = new Set<HierarchyItemVM>()
    // Re-entrant restore guard: a restore Expand() can realize a child that is itself restored,
    // nesting withRestoring. A counter (not a boolean) keeps save() suppressed until the whole
    // cascade unwinds, so no partial state is ever persisted mid-restore.
    private restoringDepth = 0
    private disposed = false
    private sessionState: TreeState | undefined   // untitled fallback
    private restoreState: RestoreState | undefined
    private readonly selectedVms: HierarchyItemVM[] = []
    private anchorVm: HierarchyItemVM | undefined

    constructor(
        private readonly tree: HierarchyTreeVM,
        private readonly solution: Solution,
        private readonly bags: IBagPersister,
    )
    {
    }

    // Count of VMs currently tracked for view-state changes. Read-only diagnostic: lets a test
    // assert that expand/collapse churn does not retain disposers for VMs that left the tree.
    public get TrackedVmCount(): number { return this.vmSubs.size }

    public Start(): void
    {
        const state = this.readState()
        this.restoreState = { expanded: new Set(state.expanded), selection: new Set(state.selection), anchor: state.anchor }
        this.watch()
    }

    public dispose(): void
    {
        this.disposed = true
        for (const s of this.subs) s()
        for (const r of this.vmSubs.values()) r.dispose()
        this.subs.length = 0
        this.vmSubs.clear()
        this.rootSet.clear()
    }

    private watch(): void
    {
        this.subs.push(this.tree.Selection.Subscribe(() => this.save()))
        this.subs.push(this.tree.Roots.Subscribe(() => this.syncRoots()))
        this.syncRoots()
    }

    // Reconcile the tracked root set against the live roots: track roots that appeared, untrack
    // roots that left (a solution swap or root replacement never leaves stale subscriptions).
    private syncRoots(): void
    {
        const live = new Set(this.tree.Roots.ToArray())
        for (const vm of this.rootSet)
        {
            if (!live.has(vm)) { this.untrack(vm); this.rootSet.delete(vm) }
        }
        for (const vm of live)
        {
            if (this.rootSet.has(vm)) continue
            this.rootSet.add(vm)
            this.track(vm)
        }
    }

    private track(vm: HierarchyItemVM): void
    {
        if (this.vmSubs.has(vm)) return
        const record: TrackRecord = { dispose: () => {}, children: new Set() }
        const expansionSub = vm.PropertyChanged('IsExpanded').subscribe(() => this.save())
        const childrenSub = vm.Children.Subscribe(() => this.reconcileChildren(vm, record))
        record.dispose = () => { expansionSub.dispose(); childrenSub() }
        this.vmSubs.set(vm, record)
        this.applyRestore(vm)
        this.reconcileChildren(vm, record)
    }

    // Track newly appeared children and untrack ones that left, keeping the record in step with
    // the VM's live Children. Called on every Children mutation (realize, collapse, delta).
    private reconcileChildren(vm: HierarchyItemVM, record: TrackRecord): void
    {
        const live = new Set(vm.Children.ToArray())
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

    // Release a VM's subscriptions and, recursively, those of every child it was tracking.
    private untrack(vm: HierarchyItemVM): void
    {
        const record = this.vmSubs.get(vm)
        if (record === undefined) return
        this.vmSubs.delete(vm)
        record.dispose()
        for (const child of record.children) this.untrack(child)
        record.children.clear()
    }

    // Apply the persisted seed to a VM as it appears, consuming each name so it applies once.
    // Selection first, so a row that is both selected and expanded is selected before Expand()
    // cascades child tracking. When the seed is fully drained it is dropped entirely.
    private applyRestore(vm: HierarchyItemVM): void
    {
        const state = this.restoreState
        if (state === undefined) return
        const name = vm.CanonicalName
        if (name === '') return
        if (state.selection.has(name))
        {
            state.selection.delete(name)
            this.selectedVms.push(vm)
            if (name === state.anchor) this.anchorVm = vm
            this.withRestoring(() => this.tree.SyncSelection(this.selectedVms, this.anchorVm ?? this.selectedVms[this.selectedVms.length - 1]))
        }
        if (state.expanded.has(name))
        {
            state.expanded.delete(name)
            this.withRestoring(() => vm.Expand())
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
        this.collectExpanded(this.tree.Roots.ToArray(), expanded)
        const selected = this.tree.Selection.ToArray()
        const selection = selected.map((vm) => vm.CanonicalName).filter((n) => n !== '')
        // HierarchyTreeVM assigns Anchor AFTER the Selection mutation that fires this save, so
        // during a SelectSingle/SyncSelection it is momentarily stale (undefined). Fall back to
        // the last-selected row — exact for single-select, a sound pivot for multi-select.
        const anchor = (this.tree.Anchor ?? selected[selected.length - 1])?.CanonicalName ?? ''
        this.writeState({ expanded, selection, anchor })
    }

    private collectExpanded(vms: readonly HierarchyItemVM[], out: string[]): void
    {
        for (const vm of vms)
        {
            if (!vm.IsExpanded) continue
            const name = vm.CanonicalName
            if (name !== '') out.push(name)
            this.collectExpanded(vm.Children.ToArray(), out)
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
