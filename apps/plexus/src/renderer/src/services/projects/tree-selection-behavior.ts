import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { Selector } from '@pragmatic-tech-ai/mural/framework'

import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'

// Surfaces the single project TreeView's MULTI-selection to the explorer service,
// which distributes it back into each project's per-project selection state.
//
// The whole explorer is now ONE TreeView with unified selection (root items =
// open projects, their descendants = files), so a selection can span projects
// and the tree's DataContext is the ProjectExplorerService — not a single
// OpenProject as it was when each project had its own tree. This behavior, on
// each selection change, hands the raw selection (SelectedItems) plus the anchor
// (SelectedItem) to the service; ProjectExplorerService.ApplyTreeSelection groups
// them by owning project and populates op.SelectedNode / op.SelectedNodes, so the
// existing delete / rename / key-handling paths are unchanged.
export class TreeSelectionBehavior extends Behavior
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
        if (this.selector !== undefined && this.listener !== undefined) {
            this.selector.RemoveSelectionChangedListener(this.listener)
        }
        this.selector = undefined
        this.listener = undefined
    }

    // Push the selector's current selection to the service. A missing/foreign
    // DataContext is ignored so this stays inert off the explorer tree.
    private sync(): void
    {
        const service = this.selector?.DataContext
        if (!(service instanceof ProjectExplorerService)) return
        service.ApplyTreeSelection(this.selector!.SelectedItems, this.selector!.SelectedItem)
    }
}
