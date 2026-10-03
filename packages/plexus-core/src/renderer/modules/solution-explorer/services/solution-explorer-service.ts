import {
    Observable, ServiceProvider, ServiceKey,
    type IServiceProvider, type ICommand, type IDisposable,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    Hierarchy, HierarchyContributorRegistry, NodeKey, NodeSeverity,
    type HierarchyItem, type HierarchyHost,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    SolutionManagerService, ProjectType, type Solution, type SolutionMember, type ProjectContentNode,
    type ProjectNodeKind,
} from '@pragmatic-tech-ai/todl'
import type { BaseRef } from '../../../projects/base-binding.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { ProjectsListingContributor } from './projects-listing-contributor.js'
import { FileTreeContributor, AddNewSubmenuContributor } from './file-tree-contributor.js'
import { ReferencesContributor } from './references-contributor.js'
import { ProjectActionsContributor } from './project-actions-contributor.js'
import { ReferenceActionsContributor, ReferenceSubmenuContributor } from './reference-actions-contributor.js'
import { ReferenceNodeKey } from './reference-node-key.js'
import { ConnectionsRootContributor } from './connections-root-contributor.js'
import { ConnectionActionsContributor, ConnectionActiveSubmenuContributor, ConnectionEditorLauncherKey } from './connection-actions-contributor.js'
import { ConnectionNodeKey } from './connection-node-key.js'
import { GlobalBagPersisterKey } from '../../bags/global-bag-persister.js'
import { SolutionTreeStateService } from './solution-tree-state-service.js'

// The Solution Explorer capability: owns ONE stable Hierarchy for the service's whole life
// (so the template's HierarchyTreeBehavior / HierarchyContextMenuBehavior / Drop / Drag bundle
// binds it once — a swapped instance would leave those behaviors pointing at a stale tree, and
// HierarchyContextMenuBehavior throws on an undefined Hierarchy). It implements HierarchyHost,
// follows ActiveSolution, seeds the (unrendered) Solution root once, and re-registers the
// per-solution contributors on every rebuild (they close over the active solution). The default
// @HierarchyTreeView template binds $Hierarchy.Roots / $Hierarchy.Host. Open-on-activate climbs
// a row to its member and delegates to ProjectExplorerService.
export class SolutionExplorerService extends Observable implements HierarchyHost
{
    public static readonly Key = new ServiceKey<SolutionExplorerService>('SolutionExplorerService')
    private static readonly HierarchyProp = 'Hierarchy'
    private static readonly HasNoSolutionProp = 'HasNoSolution'
    private static readonly RootCaptionFallback = 'Solution'
    private static readonly NoFileTreeError = 'SolutionExplorerService: no active file-tree contributor'

    private hierarchy: Hierarchy | undefined
    private rootItem: HierarchyItem | undefined
    private menuServices: ServiceProvider | undefined
    private treeState: SolutionTreeStateService | undefined
    private listing: ProjectsListingContributor | undefined
    private files: FileTreeContributor | undefined
    private connectionsRoot: ConnectionsRootContributor | undefined
    private references: ReferencesContributor | undefined
    private readonly handles: IDisposable[] = []
    private activeOff: IDisposable | undefined
    private _hasNoSolution = true

    constructor(private readonly provider: IServiceProvider)
    {
        super()
    }

    // The stable Hierarchy the panel template binds ($Hierarchy.Roots / $Hierarchy.Host). Never
    // swapped after Start — only its contributors change per solution.
    public get Hierarchy(): Hierarchy | undefined { return this.hierarchy }

    // Drives the panel's empty-state text via the ToVisibility converter (true -> Visible).
    // True when no solution is open.
    public get HasNoSolution(): boolean { return this._hasNoSolution }

    // Command pass-throughs so the panel's DataContext (this service) still exposes the
    // surviving Open/New-project lifecycle commands (ProjectExplorerService owns them).
    public get OpenProjectCommand(): ICommand { return this.explorer.OpenProjectCommand }
    public get NewProjectCommand(): ICommand { return this.explorer.NewProjectCommand }

    private get explorer(): ProjectExplorerService { return this.provider.getRequired(ProjectExplorerService.Key) }

    public Start(): void
    {
        const registry = this.provider.getRequired(HierarchyContributorRegistry.Key)
        this.menuServices = this.buildMenuServices()
        this.hierarchy = new Hierarchy(registry, this, { Services: this.menuServices })
        this.rootItem = this.hierarchy.SeedRoot(NodeKey.Solution, {
            Caption: SolutionExplorerService.RootCaptionFallback,
            IconKey: NodeKey.Solution,
            Severity: NodeSeverity.Ok,
            IsExpandable: true,
        })
        this.RaisePropertyChanged(SolutionExplorerService.HierarchyProp, undefined, undefined)
        const manager = this.provider.getRequired(SolutionManagerService.Key)
        this.activeOff = manager.PropertyChanged('ActiveSolution').subscribe(() => this.rebuild(manager.ActiveSolution))
        this.rebuild(manager.ActiveSolution)
    }

    // The lazy-submenu ChildrenContributor services the Hierarchy resolves while building a
    // row's context menu (CommandMenuBuilder reads them off commandOptions.Services). The two
    // stateful ones (their snapshots fill a per-member cache across opens) are stable instances
    // over the stable reference/connection views; the stateless Add-New submenu is transient so
    // it always reads the CURRENT per-solution FileTreeContributor host.
    private buildMenuServices(): ServiceProvider
    {
        const services = new ServiceProvider()
        services.registerInstance(ReferenceSubmenuContributor.Key, new ReferenceSubmenuContributor(this.explorer.References))
        services.registerInstance(ConnectionActiveSubmenuContributor.Key, new ConnectionActiveSubmenuContributor(this.explorer.Connections))
        services.registerTransient(AddNewSubmenuContributor.Key, () => new AddNewSubmenuContributor(this.requireFiles()))
        return services
    }

    private requireFiles(): FileTreeContributor
    {
        if (this.files === undefined) throw new Error(SolutionExplorerService.NoFileTreeError)
        return this.files
    }

    private rebuild(solution: Solution | undefined): void
    {
        this.teardownCurrent()
        const registry = this.provider.getRequired(HierarchyContributorRegistry.Key)
        if (solution === undefined)
        {
            if (this.rootItem !== undefined) this.rootItem.ExtObject = undefined
            this.setHasNoSolution(true)
            return
        }
        if (this.rootItem !== undefined)
        {
            this.rootItem.Caption = solution.Name || SolutionExplorerService.RootCaptionFallback
            this.rootItem.ExtObject = solution
        }
        this.listing = new ProjectsListingContributor(solution, registry)
        this.files = new FileTreeContributor()
        this.files.SetMutations(this.explorer)
        this.files.SetReferenceView(this.explorer.References)
        this.files.SetConnectionView(this.explorer.Connections)
        // The global Connections branch (a keyed node under the Solution root) and the per-
        // project References branch are now INDEPENDENT peer contributors — no composite.
        this.connectionsRoot = new ConnectionsRootContributor(this.explorer.Connections)
        this.references = new ReferencesContributor(this.explorer.References)
        const launcher = this.provider.getRequired(ConnectionEditorLauncherKey)
        const projectActions = new ProjectActionsContributor(this.explorer)
        const referenceActions = new ReferenceActionsContributor(this.explorer.References)
        const connectionActions = new ConnectionActionsContributor(this.explorer.Connections, launcher)
        // RegisterInstance(contributor, actions?) returns an IDisposable that unregisters the
        // contributor; the action contributors pass their CommandDefinitions as the second arg.
        this.handles.push(registry.RegisterInstance(this.listing))
        this.handles.push(registry.RegisterInstance(this.files, this.files.Actions))
        this.handles.push(registry.RegisterInstance(this.connectionsRoot))
        this.handles.push(registry.RegisterInstance(this.references))
        this.handles.push(registry.RegisterInstance(projectActions, projectActions.Actions))
        this.handles.push(registry.RegisterInstance(referenceActions, referenceActions.Actions))
        this.handles.push(registry.RegisterInstance(connectionActions, connectionActions.Actions))
        this.setHasNoSolution(false)
        // The global bag persister is registered by the app (P6a DurableStoreRegistration). It
        // is absent in headless/unit contexts, so resolve it optionally — tree-state is a
        // nice-to-have layered on top, never a hard dependency of the tree itself.
        const bags = this.provider.get(GlobalBagPersisterKey)
        if (bags !== undefined && this.hierarchy !== undefined)
        {
            this.treeState = new SolutionTreeStateService(this.hierarchy, solution, bags)
            this.treeState.Start()
        }
    }

    // ── HierarchyHost ────────────────────────────────────────────────────────
    public Activate(item: HierarchyItem): void { void this.onActivate(item) }
    public CommitRename(item: HierarchyItem, newName: string): void { void this.files?.RenameNode(item, newName) }
    // Delete dispatches by node family: a reference leaf removes references, a connection leaf
    // removes connections (both selection-aware, reversible edits — no confirm); the synthetic
    // References / Connections / group rows are not deletable; every other row is a file delete.
    public Delete(item: HierarchyItem): void
    {
        if (item.Key === ReferenceNodeKey.Leaf) void this.removeReferenceSelection(item)
        else if (item.Key === ConnectionNodeKey.Leaf) void this.removeConnectionSelection(item)
        else if (item.Key === NodeKey.References || item.Key === ReferenceNodeKey.Group) { /* synthetic rows — not deletable */ }
        else if (item.Key === NodeKey.Connections || item.Key === ConnectionNodeKey.Active) { /* synthetic rows — not deletable */ }
        else void this.files?.DeleteFrom(item, this.selection())
    }
    public CanDrop(target: HierarchyItem, dragged: readonly HierarchyItem[]): boolean { return this.files?.CanDrop(target, dragged) ?? false }
    public Drop(target: HierarchyItem, dragged: readonly HierarchyItem[]): void { this.files?.Drop(target, dragged) }
    public OnItemRemoved(item: HierarchyItem): void { this.hierarchy?.Deselect(item) }

    private selection(): readonly HierarchyItem[] { return this.hierarchy?.Selection.ToArray() ?? [] }

    // Remove the reference leaf (or, when it is part of the live multi-selection, every selected
    // reference leaf) via the reference view — the key-Delete peer of the menu Remove.
    private async removeReferenceSelection(anchor: HierarchyItem): Promise<void>
    {
        const view = this.explorer.References
        const selection = this.selection().filter((item) => item.Key === ReferenceNodeKey.Leaf)
        const targets = selection.includes(anchor) && selection.length > 0 ? selection : [anchor]
        for (const item of targets)
        {
            // Each leaf removed from its own member's manifest (a selection may span projects).
            const member = FileTreeContributor.MemberOf(item)
            if (member === undefined) continue
            const leaf = item.ExtObject as { kind: ProjectType; ref: BaseRef }
            await view.RemoveMemberReference(member, leaf.kind, leaf.ref)
        }
    }

    // Remove the connection leaf (or, when part of the live multi-selection, every selected
    // connection leaf) via the connection view — the key-Delete peer of the menu Remove.
    private async removeConnectionSelection(anchor: HierarchyItem): Promise<void>
    {
        const view = this.explorer.Connections
        const selection = this.selection().filter((item) => item.Key === ConnectionNodeKey.Leaf)
        const targets = selection.includes(anchor) && selection.length > 0 ? selection : [anchor]
        for (const item of targets)
        {
            const leaf = item.ExtObject as { id: string }
            await view.RemoveConnection(leaf.id)
        }
    }

    private async onActivate(item: HierarchyItem): Promise<void>
    {
        const content = item.ExtObject as ProjectContentNode | undefined
        if (content === undefined || content.Path === undefined) return   // a member / synthetic row — nothing to open
        const member = FileTreeContributor.MemberOf(item)
        if (member === undefined) return
        await this.explorer.OpenMemberFile(member, content.Path, content.Kind as ProjectNodeKind)
    }

    private teardownCurrent(): void
    {
        this.treeState?.dispose()
        this.treeState = undefined
        for (const handle of this.handles) handle.dispose()
        this.handles.length = 0
        this.listing?.dispose()
        this.files?.dispose()
        this.connectionsRoot?.dispose()
        this.references?.dispose()
        this.listing = undefined
        this.files = undefined
        this.connectionsRoot = undefined
        this.references = undefined
    }

    private setHasNoSolution(value: boolean): void
    {
        if (this._hasNoSolution === value) return
        this._hasNoSolution = value
        this.RaisePropertyChanged(SolutionExplorerService.HasNoSolutionProp, undefined, undefined)
    }

    public dispose(): void
    {
        this.activeOff?.dispose()
        this.activeOff = undefined
        this.teardownCurrent()
        this.hierarchy?.dispose()
        this.hierarchy = undefined
        this.rootItem = undefined
        this.menuServices?.dispose()
        this.menuServices = undefined
    }
}
