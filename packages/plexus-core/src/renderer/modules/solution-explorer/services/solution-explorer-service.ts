import { Observable, ServiceKey, type IServiceProvider, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    HierarchyModel, HierarchyTreeVM, type HierarchyItemVM,
    HierarchyContributorRegistry, NodeKey, NodeSeverity,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    SolutionManagerService, type Solution, type SolutionMember, type ProjectContentNode,
    type ProjectNodeKind,
} from '@pragmatic-tech-ai/todl'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { ProjectsListingContributor } from './projects-listing-contributor.js'
import { FileTreeContributor } from './file-tree-contributor.js'

// The Solution Explorer capability: owns one HierarchyModel per open solution, follows
// ActiveSolution, seeds the root, registers the two contributors imperatively (they close
// over the active solution), and publishes a HierarchyTreeVM the panel binds. Open-on-
// activate walks the row's parent chain to its member and delegates to ProjectExplorerService.
export class SolutionExplorerService extends Observable
{
    public static readonly Key = new ServiceKey<SolutionExplorerService>('SolutionExplorerService')
    private static readonly TreeProp = 'Tree'
    private static readonly HasNoSolutionProp = 'HasNoSolution'
    private static readonly RootCaptionFallback = 'Solution'

    private _tree: HierarchyTreeVM | undefined
    private model: HierarchyModel | undefined
    private listing: ProjectsListingContributor | undefined
    private files: FileTreeContributor | undefined
    private offListing: (() => void) | undefined
    private offFiles: (() => void) | undefined
    private activeOff: { dispose(): void } | undefined

    constructor(private readonly provider: IServiceProvider)
    {
        super()
    }

    public get Tree(): HierarchyTreeVM | undefined { return this._tree }

    // Drives the panel's empty-state text via the existing ToVisibility converter (true ->
    // Visible), so no null-to-visibility converter is invented. True when no solution is open.
    public get HasNoSolution(): boolean { return this._tree === undefined }

    // Command pass-throughs so the panel's DataContext (this service) still exposes the
    // surviving Open/New-project lifecycle commands (ProjectExplorerService owns them).
    public get OpenProjectCommand(): ICommand { return this.explorer.OpenProjectCommand }
    public get NewProjectCommand(): ICommand { return this.explorer.NewProjectCommand }

    private get explorer(): ProjectExplorerService { return this.provider.getRequired(ProjectExplorerService.Key) }

    public Start(): void
    {
        const manager = this.provider.getRequired(SolutionManagerService.Key)
        this.activeOff = manager.PropertyChanged('ActiveSolution').subscribe(() => this.rebuild(manager.ActiveSolution))
        this.rebuild(manager.ActiveSolution)
    }

    private rebuild(solution: Solution | undefined): void
    {
        this.teardownCurrent()
        if (solution === undefined)
        {
            this.setTree(undefined)
            return
        }
        const registry = this.provider.getRequired(HierarchyContributorRegistry.Key)
        this.model = new HierarchyModel(registry)
        const root = this.model.SeedRoot({
            Key: NodeKey.Solution,
            Caption: solution.Name || SolutionExplorerService.RootCaptionFallback,
            IconKey: NodeKey.Solution,
            ExtObject: solution,
            Severity: NodeSeverity.Ok,
            IsExpandable: true,
        })
        this.listing = new ProjectsListingContributor(solution, registry)
        this.files = new FileTreeContributor()
        this.offListing = registry.RegisterInstance(this.listing)
        this.offFiles = registry.RegisterInstance(this.files)
        this.setTree(new HierarchyTreeVM(this.model, root, (vm) => { void this.onActivate(vm) }))
    }

    private async onActivate(vm: HierarchyItemVM): Promise<void>
    {
        const content = vm.Data as ProjectContentNode | undefined
        if (content === undefined || content.Path === undefined) return   // a member row itself — nothing to open
        let cur: HierarchyItemVM | undefined = vm
        while (cur !== undefined && cur.Parent !== undefined) cur = cur.Parent   // climb to the member (a root-level row)
        if (cur === undefined) return
        const member = cur.Data as SolutionMember
        await this.explorer.OpenMemberFile(member, content.Path, content.Kind as ProjectNodeKind)
    }

    private teardownCurrent(): void
    {
        this._tree?.dispose()
        this.offListing?.()
        this.offFiles?.()
        this.listing?.dispose()
        this.files?.dispose()
        this.offListing = undefined
        this.offFiles = undefined
        this.listing = undefined
        this.files = undefined
        this.model = undefined
    }

    private setTree(tree: HierarchyTreeVM | undefined): void
    {
        this._tree = tree
        this.RaisePropertyChanged(SolutionExplorerService.TreeProp, undefined, undefined)
        this.RaisePropertyChanged(SolutionExplorerService.HasNoSolutionProp, undefined, undefined)
    }

    public dispose(): void
    {
        this.activeOff?.dispose()
        this.activeOff = undefined
        this.teardownCurrent()
        this.setTree(undefined)
    }
}
