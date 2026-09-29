import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { Selector } from '@pragmatic-tech-ai/mural/framework'
import type { HierarchyItemVM, HierarchyTreeVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'

// Mirrors the TreeView's multi-selection into the HierarchyTreeVM's selection surface.
// Attached to the Selector (the TreeView); its DataContext is the capability service,
// which exposes Tree. On each SelectionChanged it pushes SelectedItems/SelectedItem into
// tree.SyncSelection, so the context menu (HierarchyActionContext) and the key behavior's
// Delete read a live selection. Inert off a Solution-Explorer tree (no Tree on the DC).
export class HierarchySelectionBehavior extends Behavior
{
    private selector: Selector | undefined
    private listener: (() => void) | undefined

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof Selector)) return
        this.selector = visual
        this.listener = () => this.sync()
        visual.AddSelectionChangedListener(this.listener)
        this.sync()
    }

    public override OnDetached(_visual: Visual): void
    {
        if (this.selector !== undefined && this.listener !== undefined)
        {
            this.selector.RemoveSelectionChangedListener(this.listener)
        }
        this.selector = undefined
        this.listener = undefined
    }

    private sync(): void
    {
        const tree = (this.selector?.DataContext as { Tree?: HierarchyTreeVM } | undefined)?.Tree
        if (tree === undefined || this.selector === undefined) return
        tree.SyncSelection(
            this.selector.SelectedItems as readonly HierarchyItemVM[],
            this.selector.SelectedItem as HierarchyItemVM | undefined,
        )
    }
}

export default HierarchySelectionBehavior
