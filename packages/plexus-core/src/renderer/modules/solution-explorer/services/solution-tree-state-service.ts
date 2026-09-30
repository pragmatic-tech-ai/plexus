import type { Disposable, IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import type { IBagPersister, Solution } from '@pragmatic-tech-ai/todl'
import type { HierarchyItemVM, HierarchyTreeVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'

// The persisted per-solution tree view state. All three fields are canonical names.
interface TreeState
{
    expanded: string[]
    selection: string[]
    anchor: string
}

// Persists (and — Task 7 — reactively restores) the Solution Explorer tree's expansion and
// selection, per solution, via the global durable bag store keyed by the solution's on-disk
// path. User-local view state: never committed. An untitled solution (no Storage) is held in
// memory for the session only. Writes go to the in-memory bag synchronously; the durable
// store debounces the actual disk write.
export class SolutionTreeStateService
{
    private static readonly Kind = 'solution-tree-state'
    private static readonly ExpandedProp = 'expanded'
    private static readonly SelectionProp = 'selection'
    private static readonly AnchorProp = 'anchor'

    private readonly subs: Disposable[] = []
    private readonly vmSubs = new Map<HierarchyItemVM, Disposable>()
    private restoring = false
    private disposed = false
    private sessionState: TreeState | undefined   // untitled fallback

    constructor(
        private readonly tree: HierarchyTreeVM,
        private readonly solution: Solution,
        private readonly bags: IBagPersister,
    )
    {
    }

    public Start(): void
    {
        this.watch()
    }

    public dispose(): void
    {
        this.disposed = true
        for (const s of this.subs) s.dispose()
        for (const s of this.vmSubs.values()) s.dispose()
        this.subs.length = 0
        this.vmSubs.clear()
    }

    private watch(): void
    {
        this.subs.push(this.tree.Selection.Subscribe(() => this.save()))
        this.subs.push(this.tree.Roots.Subscribe(() => this.syncRoots()))
        this.syncRoots()
    }

    // Track every current root (and its descendants) for expansion changes.
    private syncRoots(): void
    {
        for (const vm of this.tree.Roots.ToArray()) this.track(vm)
    }

    private track(vm: HierarchyItemVM): void
    {
        if (this.vmSubs.has(vm)) return
        const expansionSub = vm.PropertyChanged('IsExpanded').subscribe(() => this.save())
        const childrenSub = vm.Children.Subscribe(() => { for (const c of vm.Children.ToArray()) this.track(c) })
        this.vmSubs.set(vm, { dispose: () => { expansionSub.dispose(); childrenSub.dispose() } })
        for (const c of vm.Children.ToArray()) this.track(c)
    }

    private save(): void
    {
        if (this.restoring || this.disposed) return
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

    private bag(): IPropertyBag
    {
        return this.bags.Bag(SolutionTreeStateService.Kind, this.key())
    }

    private key(): string
    {
        return this.solution.Storage?.Root ?? ''
    }
}
