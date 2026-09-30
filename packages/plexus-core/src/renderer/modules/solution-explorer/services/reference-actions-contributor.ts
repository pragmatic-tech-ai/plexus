import {
    HierarchyAction, NodeKey,
    type IHierarchyActionContributor, type HierarchyActionContext, type HierarchyItemVM,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import { ReferenceNodeKey } from './reference-node-key.js'
import type { IReferenceView } from './reference-view.js'
import type { BaseRef } from '../../../projects/base-binding.js'

// The identity a reference leaf carries as its Data — the kind + the pinned ref.
interface LeafData
{
    readonly kind: ProjectType
    readonly ref: BaseRef
}

// The identity a group header carries as its Data.
interface GroupData
{
    readonly group: ProjectType
}

// Contributes the References-branch context-menu actions, routed to IReferenceView. The
// References node offers Add Meta-model ▸ (libraries are added from the Libraries group,
// which only appears for an architecture — so no synchronous offersLibraries gate is
// needed here). A group header offers Add ▸ for its kind; a leaf offers Set Version ▸
// (current version non-executable) and a selection-aware Remove. Submenus fill async
// from the available set; an empty set renders one disabled item.
export class ReferenceActionsContributor implements IHierarchyActionContributor
{
    private static readonly AddMetaModelLabel = 'Add Meta-model'
    private static readonly AddLabel = 'Add'
    private static readonly SetVersionLabel = 'Set Version'
    private static readonly RemoveLabel = 'Remove'
    private static readonly NothingToAddLabel = '(nothing to add)'
    private static readonly NoOtherVersionsLabel = '(no other versions)'

    public readonly ActionKeys = [NodeKey.References, ReferenceNodeKey.Group, ReferenceNodeKey.Leaf]

    constructor(private readonly view: IReferenceView)
    {
    }

    public ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]
    {
        const anchor = context.Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        if (member === undefined) return []
        switch (anchor.Key)
        {
            case NodeKey.References:
                return [this.addAction(ReferenceActionsContributor.AddMetaModelLabel, member, ProjectType.MetaModel)]
            case ReferenceNodeKey.Group:
                return [this.addAction(ReferenceActionsContributor.AddLabel, member, (anchor.Data as GroupData).group)]
            case ReferenceNodeKey.Leaf:
            {
                const leaf = anchor.Data as LeafData
                return [this.setVersionAction(member, leaf), this.removeAction(context)]
            }
            default:
                return []
        }
    }

    private addAction(label: string, member: SolutionMember, kind: ProjectType): HierarchyAction
    {
        const action = HierarchyAction.Command(label, () => {})
        void (async () =>
        {
            const available = await this.view.AvailableReferencesFor(member, kind)
            if (available.length === 0)
            {
                action.Children.Add(ReferenceActionsContributor.disabled(ReferenceActionsContributor.NothingToAddLabel))
                return
            }
            for (const ref of available)
            {
                action.Children.Add(HierarchyAction.Command(`${ref.id}@${ref.version}`, () => void this.view.AddMemberReference(member, kind, ref)))
            }
        })()
        return action
    }

    private setVersionAction(member: SolutionMember, leaf: LeafData): HierarchyAction
    {
        const action = HierarchyAction.Command(ReferenceActionsContributor.SetVersionLabel, () => {})
        void (async () =>
        {
            const versions = await this.view.AvailableVersionsFor(member, leaf.kind, leaf.ref.id)
            if (versions.length === 0)
            {
                action.Children.Add(ReferenceActionsContributor.disabled(ReferenceActionsContributor.NoOtherVersionsLabel))
                return
            }
            for (const version of versions)
            {
                action.Children.Add(HierarchyAction.Command(
                    version,
                    () => void this.view.SetMemberReferenceVersion(member, leaf.kind, leaf.ref.id, version),
                    { canExecute: () => version !== leaf.ref.version }))
            }
        })()
        return action
    }

    private removeAction(context: HierarchyActionContext): HierarchyAction
    {
        return HierarchyAction.Command(ReferenceActionsContributor.RemoveLabel, (ctx) => void this.removeFrom(ctx), { context })
    }

    // Selection-aware Remove: when the anchor is part of the live selection, remove every
    // selected reference leaf (each from its own kind's list); otherwise just the anchor.
    private async removeFrom(context: HierarchyActionContext): Promise<void>
    {
        const anchor = context.Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        if (member === undefined) return
        const leaves = context.Selection.filter((vm) => vm.Key === ReferenceNodeKey.Leaf)
        const targets = leaves.includes(anchor) && leaves.length > 0 ? leaves : [anchor]
        for (const vm of targets)
        {
            const leaf = vm.Data as LeafData
            await this.view.RemoveMemberReference(member, leaf.kind, leaf.ref)
        }
    }

    private static disabled(label: string): HierarchyAction
    {
        return HierarchyAction.Command(label, () => {}, { canExecute: () => false })
    }
}
