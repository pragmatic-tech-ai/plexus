import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { TreeView, TreeViewItem, type ItemTemplateSelector } from '@pragmatic-tech-ai/mural/framework'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'

import { OpenProject } from './open-project.js'
import { ProjectNode } from './project.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'

// View glue for the single unified project TreeView: picks the row template by
// item type, expands each project root by default, and reveals (expands) a folder
// the explorer service just filled by an import.
//
// The explorer renders one TreeView whose roots are OpenProjects and whose
// descendants are ProjectNodes — two different row templates. mural's TreeView
// has no implicit by-DataType template resolution (unlike ContentControl); it
// resolves a row via ItemTemplateSelector (which wins over ItemTemplate) and
// PROPAGATES that selector down every level. So a single selector on the root
// tree renders the OpenProject header at the top and the ProjectNode row at every
// depth. The selector is a function DP — unexpressible in markup — hence this
// behavior. Templates are resolved lazily (per row, at generation time) so their
// resource lookup runs when the tree is fully attached, not at attach time.
//
// Separately, TreeViewItem defaults to collapsed; the old per-project design kept
// projects expanded via a bound custom chevron. A ContainerPrepared hook expands
// each project root once when its container is first realized (a WeakSet keeps a
// user's later manual collapse from being undone on a rebuild). The same hook
// records each realized node's container so a reveal request (import into a
// folder) can expand that folder in place — expansion is TreeViewItem view-state
// the service can't reach, so it raises the request and this behavior applies it.
export class ProjectTreeTemplateBehavior extends Behavior
{
    private tree: TreeView | undefined
    private prepared: ((container: Visual, item: unknown, index: number) => void) | undefined
    private readonly autoExpanded = new WeakSet<OpenProject>()
    // The realized container for each node, so a reveal can expand it in place.
    // Weak by node so recycled/removed rows don't pin memory; a recycled
    // container rebinds through the prepared hook, refreshing the mapping.
    private readonly containers = new WeakMap<ProjectNode, TreeViewItem>()
    private revealUnsub: (() => void) | undefined
    private revealWired = false

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof TreeView)) return
        this.tree = visual

        const selector: ItemTemplateSelector = (item) =>
            visual.TryFindResource(item instanceof OpenProject ? 'OpenProjectTemplate' : 'ProjectNodeTemplate') as DataTemplate | undefined
        visual.ItemTemplateSelector = selector

        this.prepared = (container, item) => this.onPrepared(container, item)
        visual.AddContainerPreparedListener(this.prepared)
        // Belt-and-suspenders: expand any roots already realized before the
        // listener registered (all root containers are OpenProjects).
        for (const root of visual.RootItems) root.IsExpanded = true
        this.wireReveal()
    }

    public override OnDetached(_visual: Visual): void
    {
        if (this.tree !== undefined && this.prepared !== undefined)
        {
            this.tree.RemoveContainerPreparedListener(this.prepared)
        }
        this.revealUnsub?.()
        this.revealUnsub = undefined
        this.revealWired = false
        this.tree = undefined
        this.prepared = undefined
    }

    private onPrepared(container: Visual, item: unknown): void
    {
        if (!(container instanceof TreeViewItem)) return
        if (item instanceof OpenProject) { this.expandRoot(container, item); return }
        if (item instanceof ProjectNode) this.containers.set(item, container)
        // The service's DataContext may not have been bound when OnAttached ran;
        // by the time a container is prepared the tree is materialized, so retry.
        this.wireReveal()
    }

    private expandRoot(container: TreeViewItem, item: OpenProject): void
    {
        if (this.autoExpanded.has(item)) return
        this.autoExpanded.add(item)
        container.IsExpanded = true
    }

    // Subscribe once to the hosting service's reveal requests. The service is the
    // DataContext of the tree's DataTemplate root (an ancestor of the TreeView),
    // found by walking up — the same resolution TreeDragDropBehavior uses.
    private wireReveal(): void
    {
        if (this.revealWired || this.tree === undefined) return
        const service = this.serviceOf(this.tree)
        if (service === undefined) return
        this.revealWired = true
        this.revealUnsub = service.AddRevealListener((folder) => this.reveal(folder))
    }

    private serviceOf(from: Visual): ProjectExplorerService | undefined
    {
        let cur: Visual | undefined = from
        while (cur !== undefined) {
            if (cur.DataContext instanceof ProjectExplorerService) return cur.DataContext
            cur = cur.GetVisualParent()
        }
        return undefined
    }

    private reveal(folder: ProjectNode): void
    {
        const container = this.containers.get(folder)
        if (container !== undefined) container.IsExpanded = true
    }
}
