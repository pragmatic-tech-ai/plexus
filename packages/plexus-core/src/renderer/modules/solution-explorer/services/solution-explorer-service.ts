import {
    Observable, ServiceProvider, ServiceKey,
    type ICommand, type IDisposable,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    Hierarchy, HierarchyContributorRegistry, NodeKey, NodeSeverity,
    type HierarchyItem, type HierarchyHost,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    SolutionManagerService, ProjectType, BuildService,
    type Solution, type SolutionMember, type ProjectContentNode,
    type ProjectNodeKind,
} from '@pragmatic-tech-ai/todl'
import { BackgroundWorkService } from '../../background-work/index.js'
import { BuildClientKey } from '../../build/index.js'
import type { BaseRef } from '../../../projects/base-binding.js'
import { SolutionWorkspaceService } from './solution-workspace-service.js'
import { ProjectCommandsService } from './project-commands-service.js'
import { ProjectsRootContributor } from './projects-provider.js'
import { FileTreeContributor, AddNewSubmenuContributor } from './file-tree-contributor.js'
import { ReferencesContributor } from './references-contributor.js'
import { ProjectActionsContributor } from './project-actions-contributor.js'
import { ReferenceActionsContributor, ReferenceSubmenuContributor } from './reference-actions-contributor.js'
import { ReferenceNodeKey } from './reference-node-key.js'
import { ConnectionsRootContributor } from './connections-root-contributor.js'
import { SolutionRootContributor } from './solution-root-contributor.js'
import { ConnectionActionsContributor, ConnectionActiveSubmenuContributor, ConnectionEditorLauncherKey } from './connection-actions-contributor.js'
import { BuildContributor, BuildFlavorSubmenuContributor } from './build-contributor.js'
import { HtmlAppContributor } from './html-app-contributor.js'
import { PreviewServerKey } from '../../preview-server/preview-server.js'
import { FileSystemService } from '../../storage/file-system-service.js'
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
// a row to its member and delegates to SolutionWorkspaceService.
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
    private projectsRoot: ProjectsRootContributor | undefined
    private files: FileTreeContributor | undefined
    private connectionsRoot: ConnectionsRootContributor | undefined
    private references: ReferencesContributor | undefined
    private readonly handles: IDisposable[] = []
    private activeOff: IDisposable | undefined
    private selectionOff: (() => void) | undefined
    private _hasNoSolution = true
    private disposed = false

    constructor(private readonly provider: ServiceProvider)
    {
        super()
    }

    // The stable Hierarchy the panel template binds ($Hierarchy.Roots / $Hierarchy.Host). Never
    // swapped after creation — only its contributors change per solution. Created lazily on first
    // access: the panel binds $Hierarchy on its behaviors at ATTACH time, and when the Solution
    // Explorer is the shell's default navigation destination that pane resolves at startup BEFORE
    // Start() runs — HierarchyContextMenuBehavior throws on an undefined Hierarchy, so it must
    // already exist. Not recreated after dispose() (stays undefined, as the lifecycle tests expect).
    public get Hierarchy(): Hierarchy | undefined
    {
        if (this.hierarchy === undefined && !this.disposed) this.ensureHierarchy()
        return this.hierarchy
    }

    // Build the Hierarchy + its menu-service scope + seeded root once. Idempotent and safe to call
    // from both the lazy getter (pane resolves first) and Start() (service started first).
    private ensureHierarchy(): void
    {
        if (this.hierarchy !== undefined || this.disposed) return
        const registry = this.provider.getRequired(HierarchyContributorRegistry.Key)
        this.menuServices = this.buildMenuServices()
        this.hierarchy = new Hierarchy(registry, this, { Services: this.menuServices })
        // The seeded root is an INVISIBLE container (mural projects a root's children onto Roots).
        // Its key is deliberately NOT NodeKey.Solution so the Solution-keyed branch contributors
        // fire under the single visible Solution node (emitted by SolutionRootContributor), not
        // here — giving the tree one top-level row (the solution) instead of bare rows.
        this.rootItem = this.hierarchy.SeedRoot(SolutionRootContributor.ContainerKey, {
            Caption: SolutionExplorerService.RootCaptionFallback,
            Severity: NodeSeverity.Ok,
            IsExpandable: true,
        })
        this.RaisePropertyChanged(SolutionExplorerService.HierarchyProp, undefined, undefined)
    }

    // Drives the panel's empty-state text via the ToVisibility converter (true -> Visible).
    // True when no solution is open.
    public get HasNoSolution(): boolean { return this._hasNoSolution }

    // Command pass-throughs so the panel's DataContext (this service) still exposes the
    // Open/New-project commands (ProjectCommandsService owns them).
    public get OpenProjectCommand(): ICommand { return this.commands.OpenProjectCommand }
    public get NewProjectCommand(): ICommand { return this.commands.NewProjectCommand }

    private get workspace(): SolutionWorkspaceService { return this.provider.getRequired(SolutionWorkspaceService.Key) }
    private get commands(): ProjectCommandsService { return this.provider.getRequired(ProjectCommandsService.Key) }

    public Start(): void
    {
        // Create the hierarchy if the panel hasn't already forced it (lazy getter above).
        this.ensureHierarchy()
        const hierarchy = this.hierarchy
        if (hierarchy === undefined) return
        // Single-click opens: the mural TreeView fires host.Activate only on DOUBLE-click,
        // so wire open-on-select here — a single click (or keyboard move) selects the row,
        // and we open the file it resolves to. onActivate only opens a file row (a member /
        // folder / synthetic row resolves to no content path and no-ops), and OpenMemberFile
        // re-activates an already-open tab, so the double-click path stays harmless.
        this.selectionOff = hierarchy.Selection.Subscribe(() => this.onSelectionChanged())
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
        // A CHILD scope of the service's provider: the four local submenu contributors resolve
        // local-first, then CommandMenuBuilder.RealizeChildren falls back to the app root for
        // submenu contributors registered there (e.g. SkillRunSubmenuContributor) — a parentless
        // provider found no owner and threw when the project-row "Run Agent / Skill ▸" opened.
        const services = this.provider.createScope()
        services.registerInstance(ReferenceSubmenuContributor.Key, new ReferenceSubmenuContributor(this.workspace.References))
        services.registerInstance(ConnectionActiveSubmenuContributor.Key, new ConnectionActiveSubmenuContributor(this.workspace.Connections))
        services.registerTransient(AddNewSubmenuContributor.Key, () => new AddNewSubmenuContributor(this.requireFiles()))
        // The Build ▸ flavor submenu reads the composed per-project build systems (absent in
        // headless/unit contexts — the submenu then yields nothing rather than throwing).
        services.registerInstance(BuildFlavorSubmenuContributor.Key, new BuildFlavorSubmenuContributor(this.provider.get(BuildClientKey)))
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
        this.files = new FileTreeContributor()
        this.files.SetMutations(this.workspace)
        this.files.SetReferenceView(this.workspace.References)
        this.files.SetConnectionView(this.workspace.Connections)
        // The global Connections branch (a keyed node under the Solution root) is an INDEPENDENT
        // peer contributor. The per-project References branch is now a factory the project-rows
        // provider delegates to (not a registered contributor) — see ProjectsProvider.
        this.connectionsRoot = new ConnectionsRootContributor(this.workspace.Connections)
        this.references = new ReferencesContributor(this.workspace.References)
        // The project rows are now a delta-pushing provider (ProjectsProvider, owned by the
        // Solution root) rather than a keyed contributor: a keyed listing was skipped by
        // hierarchy.reRealize once present, so member add/remove/status never repainted. The
        // provider delegates each row's file-tree / References subtree to this.files / this.references.
        this.projectsRoot = new ProjectsRootContributor(solution, this.files, this.references)
        const launcher = this.provider.getRequired(ConnectionEditorLauncherKey)
        const projectActions = new ProjectActionsContributor(this.workspace)
        const referenceActions = new ReferenceActionsContributor(this.workspace.References)
        const connectionActions = new ConnectionActionsContributor(this.workspace.Connections, launcher)
        // The Build/Publish contributor needs runtime collaborators (BuildService + the
        // optional background-work host + the mutation façade), so it rides the RegisterInstance
        // path like the other action contributors. BuildService is a thin provider wrapper;
        // resolve a registered/substituted one and fall back to a direct construction (nothing
        // registers BuildService.Key today — Task 7's DI pass) — the same idiom publishProject uses.
        const buildClient = this.provider.getRequired(BuildClientKey)
        // HtmlAppContributor still takes a BuildService until Task 9 rewires it to the client.
        const build = this.provider.get(BuildService.Key) ?? new BuildService(this.provider)
        // Hand the Build/Publish contributor the flavor submenu instance (registered in
        // buildMenuServices) so it can warm the manifest cache at context-menu open — the Build ▸
        // submenu then shows its real rows on first open instead of a stuck "Loading…" row.
        const buildSubmenu = this.menuServices?.get(BuildFlavorSubmenuContributor.Key)
        const buildContributor = new BuildContributor(buildClient, this.provider.get(BackgroundWorkService.Key), this.workspace, buildSubmenu)
        // RegisterInstance(contributor, actions?) returns an IDisposable that unregisters the
        // contributor; the action contributors pass their CommandDefinitions as the second arg.
        // The Solution root node (single visible top-level row) is registered first so it exists
        // before the branch contributors that hang off it.
        this.handles.push(registry.RegisterInstance(new SolutionRootContributor(solution)))
        this.handles.push(registry.RegisterInstance(this.projectsRoot))
        this.handles.push(registry.RegisterInstance(this.files, this.files.Actions))
        this.handles.push(registry.RegisterInstance(this.connectionsRoot))
        this.handles.push(registry.RegisterInstance(projectActions, projectActions.Actions))
        this.handles.push(registry.RegisterInstance(referenceActions, referenceActions.Actions))
        this.handles.push(registry.RegisterInstance(connectionActions, connectionActions.Actions))
        this.handles.push(registry.RegisterInstance(buildContributor, buildContributor.Actions))
        const htmlApp = new HtmlAppContributor(build, this.provider.get(BackgroundWorkService.Key), this.provider.getRequired(FileSystemService.Key), this.provider.get(PreviewServerKey))
        this.handles.push(registry.RegisterInstance(htmlApp, htmlApp.Actions))
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
        // Expand the single Solution root by default so its project / Connections rows
        // show without a manual click (Visual Studio parity). The node is realized into
        // Roots synchronously by the SolutionRootContributor registration above.
        const solutionNode = this.hierarchy?.Roots.ToArray().find((r) => r.Key === NodeKey.Solution)
        solutionNode?.OnExpand()
    }

    // ── HierarchyHost ────────────────────────────────────────────────────────
    // Double-click (mural fires host.Activate only on a leaf double-click — a
    // branch double-click toggles expansion in the TreeView instead) opens the
    // file as a PERMANENT tab, promoting it if it was the preview.
    public Activate(item: HierarchyItem): void { void this.onActivate(item, false) }
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
        const view = this.workspace.References
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
        const view = this.workspace.Connections
        const selection = this.selection().filter((item) => item.Key === ConnectionNodeKey.Leaf)
        const targets = selection.includes(anchor) && selection.length > 0 ? selection : [anchor]
        for (const item of targets)
        {
            const leaf = item.ExtObject as { id: string }
            await view.RemoveConnection(leaf.id)
        }
    }

    // Open-on-select: a single click (or keyboard move) that lands on exactly one row opens
    // the file it resolves to. A multi-selection (Ctrl/Shift) does not open — it is a bulk
    // gesture for delete/menu, not a navigation. onActivate decides what is openable.
    private onSelectionChanged(): void
    {
        const selection = this.selection()
        if (selection.length !== 1) return
        // A single click or keyboard move is navigation, not a commitment: open
        // the row's file in the reused ephemeral PREVIEW tab (VS Code parity).
        void this.onActivate(selection[0]!, true)
    }

    private async onActivate(item: HierarchyItem, preview: boolean): Promise<void>
    {
        const content = item.ExtObject as ProjectContentNode | undefined
        if (content === undefined || content.Path === undefined) return   // a member / synthetic row — nothing to open
        const member = FileTreeContributor.MemberOf(item)
        if (member === undefined) return
        await this.workspace.OpenMemberFile(member, content.Path, content.Kind as ProjectNodeKind, preview)
    }

    private teardownCurrent(): void
    {
        this.treeState?.dispose()
        this.treeState = undefined
        for (const handle of this.handles) handle.dispose()
        this.handles.length = 0
        this.projectsRoot?.dispose()
        this.files?.dispose()
        this.connectionsRoot?.dispose()
        this.references?.dispose()
        this.projectsRoot = undefined
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
        this.disposed = true
        this.selectionOff?.()
        this.selectionOff = undefined
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
