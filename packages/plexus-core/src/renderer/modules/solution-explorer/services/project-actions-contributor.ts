import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { VersionPart } from '../../../projects/semver-bump.js'
import { FileTreeContributor } from './file-tree-contributor.js'
import type { IContentMutations } from '../../project-explorer/services/content-mutations.js'

// Dispatches the project-lifecycle context-menu commands for a member (project) row —
// Remove from Solution / Bump Version ▸ / Set Version… / Manage References… / Refresh
// Bases / Update Agent Metadata — to the IContentMutations façade (the re-typed
// ProjectExplorerService). An action-only contributor: Contribute yields no nodes (the
// project rows come from ProjectsProvider); it exists to Resolve the commands
// its DSL-declared CommandDefinitions carry. Producer/version gating rides each resolved
// command's CanExecute. (Publish is contributed by the build module — Task 6.)
export class ProjectActionsContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<ProjectActionsContributor>('ProjectActionsContributor')

    public static readonly RemoveId = 'project.remove'
    public static readonly BumpVersionId = 'project.bumpVersion'
    public static readonly BumpMajorId = 'project.bumpVersion.major'
    public static readonly BumpMinorId = 'project.bumpVersion.minor'
    public static readonly BumpPatchId = 'project.bumpVersion.patch'
    public static readonly SetVersionId = 'project.setVersion'
    public static readonly ManageReferencesId = 'project.manageReferences'
    public static readonly RefreshBasesId = 'project.refreshBases'
    public static readonly UpdateAgentMetadataId = 'project.updateAgentMetadata'

    private static readonly RemoveLabel = 'Remove from Solution'
    private static readonly BumpVersionLabel = 'Bump Version'
    private static readonly MajorLabel = 'Major'
    private static readonly MinorLabel = 'Minor'
    private static readonly PatchLabel = 'Patch'
    private static readonly SetVersionLabel = 'Set Version…'
    private static readonly ManageReferencesLabel = 'Manage References…'
    private static readonly RefreshBasesLabel = 'Refresh Bases'
    private static readonly UpdateAgentMetadataLabel = 'Update Agent Metadata'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 10

    // The project-row CommandDefinitions, Context-tagged to NodeKey.Project. Passed to
    // HierarchyContributorRegistry.RegisterInstance(this, this.Actions) at rebuild() — the
    // runtime-dep (IContentMutations) ctor keeps this off the module DSL path.
    public readonly Actions: readonly CommandDefinition[]

    constructor(private readonly mutations: IContentMutations)
    {
        const bump = ProjectActionsContributor.command(ProjectActionsContributor.BumpVersionId, ProjectActionsContributor.BumpVersionLabel)
        bump.AddChild(ProjectActionsContributor.command(ProjectActionsContributor.BumpMajorId, ProjectActionsContributor.MajorLabel))
        bump.AddChild(ProjectActionsContributor.command(ProjectActionsContributor.BumpMinorId, ProjectActionsContributor.MinorLabel))
        bump.AddChild(ProjectActionsContributor.command(ProjectActionsContributor.BumpPatchId, ProjectActionsContributor.PatchLabel))
        this.Actions = [
            ProjectActionsContributor.command(ProjectActionsContributor.RemoveId, ProjectActionsContributor.RemoveLabel),
            bump,
            ProjectActionsContributor.command(ProjectActionsContributor.SetVersionId, ProjectActionsContributor.SetVersionLabel),
            ProjectActionsContributor.command(ProjectActionsContributor.ManageReferencesId, ProjectActionsContributor.ManageReferencesLabel, true),
            ProjectActionsContributor.command(ProjectActionsContributor.RefreshBasesId, ProjectActionsContributor.RefreshBasesLabel),
            ProjectActionsContributor.command(ProjectActionsContributor.UpdateAgentMetadataId, ProjectActionsContributor.UpdateAgentMetadataLabel),
        ]
    }

    private static command(id: string, title: string, separatorBefore = false): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Context = HierarchyContext.For(NodeKey.Project)
        def.SeparatorBefore = separatorBefore
        return def
    }

    // No node production — the member rows are ProjectsProvider's; this
    // contributor only owns the project-row commands.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        const m = this.mutations
        const versioned = (): boolean => m.IsVersionedMember(member)
        const canRefreshBases = (): boolean => m.CanRefreshBasesMember(member)
        switch (commandId)
        {
            case ProjectActionsContributor.RemoveId:
                return new RelayCommand(() => void m.RemoveMember(member))
            case ProjectActionsContributor.BumpVersionId:
                return new RelayCommand(() => {}, versioned)
            case ProjectActionsContributor.BumpMajorId:
                return new RelayCommand(() => void m.BumpMemberVersion(member, VersionPart.Major), versioned)
            case ProjectActionsContributor.BumpMinorId:
                return new RelayCommand(() => void m.BumpMemberVersion(member, VersionPart.Minor), versioned)
            case ProjectActionsContributor.BumpPatchId:
                return new RelayCommand(() => void m.BumpMemberVersion(member, VersionPart.Patch), versioned)
            case ProjectActionsContributor.SetVersionId:
                return new RelayCommand(() => void m.SetMemberVersion(member), versioned)
            case ProjectActionsContributor.ManageReferencesId:
                return new RelayCommand(() => void m.ManageMemberReferences(member), canRefreshBases)
            case ProjectActionsContributor.RefreshBasesId:
                return new RelayCommand(() => m.RefreshMemberBases(member), canRefreshBases)
            case ProjectActionsContributor.UpdateAgentMetadataId:
                return new RelayCommand(() => void m.UpdateMemberAgentMetadata(member), () => m.SupportsScaffoldMember(member))
            default:
                return undefined
        }
    }
}

export default ProjectActionsContributor
