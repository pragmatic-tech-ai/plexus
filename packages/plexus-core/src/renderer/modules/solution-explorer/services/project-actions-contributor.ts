import { HierarchyAction, NodeKey, type IHierarchyActionContributor, type HierarchyActionContext } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { VersionPart } from '../../../projects/semver-bump.js'
import { FileTreeContributor } from './file-tree-contributor.js'
import type { IContentMutations } from '../../project-explorer/services/content-mutations.js'

// Contributes the project-lifecycle context-menu actions for a member (project) row —
// Close / Publish / Bump Version ▸ / Set Version… / Manage References… / Refresh Bases /
// Update Agent Metadata — routed to the IContentMutations façade (the re-typed
// ProjectExplorerService). Producer-only actions are canExecute-gated.
export class ProjectActionsContributor implements IHierarchyActionContributor
{
    private static readonly CloseLabel = 'Close Project'
    private static readonly PublishLabel = 'Publish'
    private static readonly BumpVersionLabel = 'Bump Version'
    private static readonly MajorLabel = 'Major'
    private static readonly MinorLabel = 'Minor'
    private static readonly PatchLabel = 'Patch'
    private static readonly SetVersionLabel = 'Set Version…'
    private static readonly ManageReferencesLabel = 'Manage References…'
    private static readonly RefreshBasesLabel = 'Refresh Bases'
    private static readonly UpdateAgentMetadataLabel = 'Update Agent Metadata'

    public readonly ActionKeys = [NodeKey.Project]

    constructor(private readonly mutations: IContentMutations)
    {
    }

    public ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]
    {
        const member = FileTreeContributor.MemberOf(context.Anchor)
        if (member === undefined) return []
        const m = this.mutations
        const versioned = () => m.IsVersionedMember(member)

        const bump = HierarchyAction.Command(ProjectActionsContributor.BumpVersionLabel, () => {}, { canExecute: versioned })
        bump.Children.Add(HierarchyAction.Command(ProjectActionsContributor.MajorLabel, () => void m.BumpMemberVersion(member, VersionPart.Major), { canExecute: versioned }))
        bump.Children.Add(HierarchyAction.Command(ProjectActionsContributor.MinorLabel, () => void m.BumpMemberVersion(member, VersionPart.Minor), { canExecute: versioned }))
        bump.Children.Add(HierarchyAction.Command(ProjectActionsContributor.PatchLabel, () => void m.BumpMemberVersion(member, VersionPart.Patch), { canExecute: versioned }))

        return [
            HierarchyAction.Command(ProjectActionsContributor.CloseLabel, () => void m.CloseMember(member)),
            HierarchyAction.Separator(),
            HierarchyAction.Command(ProjectActionsContributor.PublishLabel, () => void m.PublishMember(member), { canExecute: versioned }),
            bump,
            HierarchyAction.Command(ProjectActionsContributor.SetVersionLabel, () => void m.SetMemberVersion(member), { canExecute: versioned }),
            HierarchyAction.Separator(),
            HierarchyAction.Command(ProjectActionsContributor.ManageReferencesLabel, () => void m.ManageMemberReferences(member), { canExecute: () => m.CanRefreshBasesMember(member) }),
            HierarchyAction.Command(ProjectActionsContributor.RefreshBasesLabel, () => m.RefreshMemberBases(member), { canExecute: () => m.CanRefreshBasesMember(member) }),
            HierarchyAction.Command(ProjectActionsContributor.UpdateAgentMetadataLabel, () => void m.UpdateMemberAgentMetadata(member), { canExecute: () => m.SupportsScaffoldMember(member) }),
        ]
    }
}
