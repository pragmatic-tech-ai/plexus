import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { ItemsControl } from '@pragmatic-tech-ai/mural/framework'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'

// A row container whose expansion this behavior drives (TreeViewItem at runtime).
interface ExpandableContainer { IsExpanded: boolean }

// A row VM whose expansion this behavior reads (HierarchyItemVM at runtime).
interface ExpandableVm { IsExpanded: boolean; PropertyChanged(name: string): { subscribe(handler: () => void): Disposable } }

// Syncs each realized TreeViewItem's IsExpanded FROM its bound HierarchyItemVM — the
// data->view direction the framework's own view->data relay lacks. Together with the VM's
// programmatic Expand()/Collapse() this lets the tree-state service restore expansion. Attached
// to the Solution Explorer's TreeView alongside HierarchySelectionBehavior; uses the ItemsControl
// container-realization hooks so it works under virtualization.
export class HierarchyExpansionBehavior extends Behavior
{
    private static readonly IsExpandedProp = 'IsExpanded'

    private items: ItemsControl | undefined
    private readonly wired = new Map<object, Disposable>()
    private readonly prepared = (container: Visual, item: unknown): void => this.Wire(container, item)
    private readonly cleared = (container: Visual): void => this.Unwire(container)

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof ItemsControl)) return
        this.items = visual
        visual.AddContainerPreparedListener(this.prepared)
        visual.AddContainerClearedListener(this.cleared)
    }

    public override OnDetached(_visual: Visual): void
    {
        this.items?.RemoveContainerPreparedListener(this.prepared)
        this.items?.RemoveContainerClearedListener(this.cleared)
        for (const d of this.wired.values()) d.dispose()
        this.wired.clear()
        this.items = undefined
    }

    // Realize-time + ongoing sync for one container/VM pair. Public for unit testing.
    public Wire(container: unknown, item: unknown): void
    {
        const c = container as ExpandableContainer
        const vm = item as ExpandableVm | undefined
        if (vm === undefined || typeof vm.IsExpanded !== 'boolean') return
        // Drop any prior subscription for this container first — a recycled container reaching
        // Wire again without an intervening clear must not leave the old VM driving it.
        this.Unwire(container)
        if (c.IsExpanded !== vm.IsExpanded) c.IsExpanded = vm.IsExpanded
        const sub = vm.PropertyChanged(HierarchyExpansionBehavior.IsExpandedProp).subscribe(() =>
        {
            if (c.IsExpanded !== vm.IsExpanded) c.IsExpanded = vm.IsExpanded
        })
        this.wired.set(container as object, sub)
    }

    public Unwire(container: unknown): void
    {
        const key = container as object
        const sub = this.wired.get(key)
        if (sub !== undefined) { sub.dispose(); this.wired.delete(key) }
    }
}

export default HierarchyExpansionBehavior
