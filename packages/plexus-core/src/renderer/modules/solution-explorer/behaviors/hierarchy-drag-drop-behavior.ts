import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { DataObject, DragDropEffects, type DragEventArgs, type DragStartSpec } from '@pragmatic-tech-ai/mural/visual-engine'
import { HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'

// Drag-and-drop MOVE for the Solution Explorer, ported from the retired project
// TreeDragDropBehavior and retargeted to the HierarchyHost. Attached to each row
// (DataContext = HierarchyItemVM). A row is both a drag SOURCE (packages the dragged
// set — the selection if the pressed row is in it, else just that row) and a drop
// TARGET (validated + applied through the host, which routes to the member provider's
// CanAccept + the mutation façade's move).

interface DropHost
{
    readonly Tree?: { readonly Selection: { ToArray(): readonly HierarchyItemVM[] } }
    CanDrop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): boolean
    Drop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): void
}

// The `is<X>` type-guard free-function house-style exception.
function asDropHost(dc: unknown): DropHost | undefined
{
    const h = dc as Partial<DropHost> | undefined
    return h !== undefined && typeof h.CanDrop === 'function' && typeof h.Drop === 'function' ? (h as DropHost) : undefined
}

export class HierarchyDragDropBehavior extends Behavior
{
    // The DataObject format key the dragged HierarchyItemVM set travels under.
    private static readonly ItemsFormat = 'plexus/hierarchy-items'

    private visual: Visual | undefined
    private readonly onOver = (a: unknown): void => this.over(a as DragEventArgs)
    private readonly onDrop = (a: unknown): void => this.drop(a as DragEventArgs)

    public override OnAttached(visual: Visual): void
    {
        this.visual = visual
        visual.AllowDrop = true
        visual.IsDraggable = true            // re-read DataContext at drag time (unbound at attach)
        visual.OnDragStart = (source) => this.startDrag(source)
        visual.AddRoutedEventListener('DragOver', this.onOver)
        visual.AddRoutedEventListener('Drop', this.onDrop)
    }

    public override OnDetached(visual: Visual): void
    {
        visual.RemoveRoutedEventListener('DragOver', this.onOver)
        visual.RemoveRoutedEventListener('Drop', this.onDrop)
        visual.OnDragStart = undefined
        this.visual = undefined
    }

    private startDrag(source: Visual): DragStartSpec | null
    {
        const vm = source.DataContext
        if (!(vm instanceof HierarchyItemVM)) return null
        const selection = this.hostOf(source)?.Tree?.Selection.ToArray() ?? []
        const dragged = selection.includes(vm) ? selection : [vm]
        const data = new DataObject()
        data.Set(HierarchyDragDropBehavior.ItemsFormat, dragged)
        return { data, effects: DragDropEffects.Move }
    }

    private over(a: DragEventArgs): void
    {
        const dragged = a.Data.Get<readonly HierarchyItemVM[]>(HierarchyDragDropBehavior.ItemsFormat)
        const target = this.visual?.DataContext
        const host = this.hostOf(this.visual)
        if (dragged === undefined || !(target instanceof HierarchyItemVM) || host === undefined) return
        if (host.CanDrop(target, dragged)) { a.Effect = DragDropEffects.Move; a.Handled = true }
    }

    private drop(a: DragEventArgs): void
    {
        const dragged = a.Data.Get<readonly HierarchyItemVM[]>(HierarchyDragDropBehavior.ItemsFormat)
        const target = this.visual?.DataContext
        const host = this.hostOf(this.visual)
        if (dragged === undefined || !(target instanceof HierarchyItemVM) || host === undefined) return
        host.Drop(target, dragged)
        a.Handled = true
    }

    // The host owning this tree — the DataContext up the visual chain that answers
    // CanDrop/Drop (the capability service).
    private hostOf(from: Visual | undefined): DropHost | undefined
    {
        let cur: Visual | undefined = from
        while (cur !== undefined)
        {
            const host = asDropHost(cur.DataContext)
            if (host !== undefined) return host
            cur = cur.GetVisualParent()
        }
        return undefined
    }
}

export default HierarchyDragDropBehavior
