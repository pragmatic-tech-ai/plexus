import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext, type ICommandContributor } from '@pragmatic-tech-ai/mural/framework'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import { ReferenceNodeKey } from './reference-node-key.js'
import type { IReferenceView } from './reference-view.js'
import type { BaseRef } from '../../../projects/base-binding.js'

// The identity a reference leaf carries as its ExtObject — the kind + the pinned ref.
interface LeafData
{
    readonly kind: ProjectType
    readonly ref: BaseRef
}

// The identity a group header carries as its ExtObject.
interface GroupData
{
    readonly group: ProjectType
}

// Dispatches the References-branch context-menu commands, routed to IReferenceView. The
// References node offers Add Meta-model ▸, a group header Add ▸ for its kind, and a leaf
// Set Version ▸ (current version non-executable) + a selection-aware Remove. The two
// dynamic submenus (available refs / versions) are supplied by ReferenceSubmenuContributor
// as a lazy ChildrenContributor; this contributor Resolves every command id — including the
// dynamic child ids, statelessly, by decoding the id and re-reading the anchor.
export class ReferenceActionsContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<ReferenceActionsContributor>('ReferenceActionsContributor')

    public static readonly AddMetaModelId = 'reference.addMetaModel'
    public static readonly AddGroupId = 'reference.addGroup'
    public static readonly SetVersionId = 'reference.setVersion'
    public static readonly RemoveId = 'reference.remove'
    // Dynamic child ids: `add::<kind>::<id>::<version>` and `setVersion::<version>`.
    public static readonly AddChildPrefix = 'reference.add::'
    public static readonly SetVersionChildPrefix = 'reference.setVersion::'
    private static readonly ChildSeparator = '::'

    private static readonly AddMetaModelLabel = 'Add Meta-model'
    private static readonly AddLabel = 'Add'
    private static readonly SetVersionLabel = 'Set Version'
    private static readonly RemoveLabel = 'Remove'

    public readonly ParentKeys = [NodeKey.References]
    public readonly Order = 10

    // The References-branch CommandDefinitions, Context-tagged per node family. The two Add
    // submenus + the Set Version submenu name ReferenceSubmenuContributor as their lazy
    // ChildrenContributor. Passed to RegisterInstance(this, this.Actions) at rebuild() — the
    // runtime-dep (IReferenceView) ctor keeps this off the module DSL path.
    public readonly Actions: readonly CommandDefinition[]

    constructor(private readonly view: IReferenceView)
    {
        this.Actions = [
            ReferenceActionsContributor.submenu(ReferenceActionsContributor.AddMetaModelId, ReferenceActionsContributor.AddMetaModelLabel, NodeKey.References),
            ReferenceActionsContributor.submenu(ReferenceActionsContributor.AddGroupId, ReferenceActionsContributor.AddLabel, ReferenceNodeKey.Group),
            ReferenceActionsContributor.submenu(ReferenceActionsContributor.SetVersionId, ReferenceActionsContributor.SetVersionLabel, ReferenceNodeKey.Leaf),
            ReferenceActionsContributor.command(ReferenceActionsContributor.RemoveId, ReferenceActionsContributor.RemoveLabel, ReferenceNodeKey.Leaf),
        ]
    }

    private static command(id: string, title: string, contextKey: string): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Context = HierarchyContext.For(contextKey)
        return def
    }

    private static submenu(id: string, title: string, contextKey: string): CommandDefinition
    {
        const def = ReferenceActionsContributor.command(id, title, contextKey)
        def.ChildrenContributor = ReferenceSubmenuContributor.Key
        return def
    }

    // No node production — the References subtree is the ReferencesProvider's.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const ctx = context as HierarchyActionContext
        const anchor = ctx.Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        if (member === undefined) return undefined

        if (commandId.startsWith(ReferenceActionsContributor.AddChildPrefix))
        {
            return this.addChildCommand(commandId, member)
        }
        if (commandId.startsWith(ReferenceActionsContributor.SetVersionChildPrefix))
        {
            return this.setVersionChildCommand(commandId, anchor)
        }
        switch (commandId)
        {
            // Submenu headers carry no behaviour of their own (the children do).
            case ReferenceActionsContributor.AddMetaModelId:
            case ReferenceActionsContributor.AddGroupId:
            case ReferenceActionsContributor.SetVersionId:
                return new RelayCommand(() => {})
            case ReferenceActionsContributor.RemoveId:
                return new RelayCommand(() => void this.removeFrom(ctx))
            default:
                return ReferenceSubmenuContributor.PlaceholderCommand(commandId)
        }
    }

    private addChildCommand(commandId: string, member: SolutionMember): ICommand
    {
        const [kind, id, version] = commandId
            .slice(ReferenceActionsContributor.AddChildPrefix.length)
            .split(ReferenceActionsContributor.ChildSeparator)
        const ref: BaseRef = { id: id ?? '', version: version ?? '' }
        return new RelayCommand(() => void this.view.AddMemberReference(member, kind as ProjectType, ref))
    }

    private setVersionChildCommand(commandId: string, anchor: HierarchyItem): ICommand
    {
        const version = commandId.slice(ReferenceActionsContributor.SetVersionChildPrefix.length)
        const member = FileTreeContributor.MemberOf(anchor)
        const leaf = anchor.ExtObject as LeafData
        return new RelayCommand(
            () => { if (member !== undefined) void this.view.SetMemberReferenceVersion(member, leaf.kind, leaf.ref.id, version) },
            () => version !== leaf.ref.version)
    }

    // Selection-aware Remove: when the anchor is part of the live selection, remove every
    // selected reference leaf (each from its own kind's list); otherwise just the anchor.
    private async removeFrom(context: HierarchyActionContext): Promise<void>
    {
        const anchor = context.Anchor
        const leaves = context.Selection.filter((vm) => vm.Key === ReferenceNodeKey.Leaf)
        const targets = leaves.includes(anchor) && leaves.length > 0 ? leaves : [anchor]
        for (const vm of targets)
        {
            // Resolve each leaf's OWN member — a selection can span projects, and each
            // reference must be removed from the manifest that declares it.
            const member = FileTreeContributor.MemberOf(vm)
            if (member === undefined) continue
            const leaf = vm.ExtObject as LeafData
            await this.view.RemoveMemberReference(member, leaf.kind, leaf.ref)
        }
    }

    // The kind a given Add-submenu parent targets: the References node adds meta-models; a
    // group header adds its own kind.
    public static AddKindFor(parentId: string, anchor: HierarchyItem): ProjectType | undefined
    {
        if (parentId === ReferenceActionsContributor.AddMetaModelId) return ProjectType.MetaModel
        if (parentId === ReferenceActionsContributor.AddGroupId) return (anchor.ExtObject as GroupData).group
        return undefined
    }

    public static AddChildId(kind: ProjectType, ref: BaseRef): string
    {
        return ReferenceActionsContributor.AddChildPrefix
            + [String(kind), ref.id, ref.version].join(ReferenceActionsContributor.ChildSeparator)
    }

    public static SetVersionChildId(version: string): string
    {
        return ReferenceActionsContributor.SetVersionChildPrefix + version
    }
}

// Supplies the available-references and available-versions submenu rows lazily. The lists
// are I/O (async) while ICommandContributor.Contribute is synchronous, so each request is
// fetched fire-and-forget into a per-member cache and the current snapshot is returned; the
// rows populate on the next open. Row behaviour is dispatched by ReferenceActionsContributor
// (the owning IHierarchyContributor), so these defs carry only Id + Title.
export class ReferenceSubmenuContributor implements ICommandContributor
{
    public static readonly Key = new ServiceKey<ReferenceSubmenuContributor>('ReferenceSubmenuContributor')

    private static readonly NothingToAddLabel = '(nothing to add)'
    private static readonly NoOtherVersionsLabel = '(no other versions)'
    private static readonly LoadingLabel = 'Loading…'
    private static readonly EmptyId = 'reference.submenu.empty'
    private static readonly LoadingId = 'reference.submenu.loading'

    private readonly cache = new Map<SolutionMember, Map<string, readonly CommandDefinition[]>>()

    constructor(private readonly view: IReferenceView)
    {
    }

    public Contribute(parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[]
    {
        const ctx = context as HierarchyActionContext
        const member = FileTreeContributor.MemberOf(ctx.Anchor)
        if (member === undefined) return []

        if (parent.Id === ReferenceActionsContributor.SetVersionId)
        {
            const leaf = ctx.Anchor.ExtObject as LeafData
            return this.snapshot(member, parent.Id + leaf.ref.id,
                async () => this.versionRows(await this.view.AvailableVersionsFor(member, leaf.kind, leaf.ref.id)))
        }

        const kind = ReferenceActionsContributor.AddKindFor(parent.Id, ctx.Anchor)
        if (kind === undefined) return []
        return this.snapshot(member, parent.Id + String(kind),
            async () => this.addRows(kind, await this.view.AvailableReferencesFor(member, kind)))
    }

    private addRows(kind: ProjectType, available: readonly BaseRef[]): readonly CommandDefinition[]
    {
        if (available.length === 0) return [ReferenceSubmenuContributor.row(ReferenceSubmenuContributor.EmptyId, ReferenceSubmenuContributor.NothingToAddLabel)]
        return available.map((ref) => ReferenceSubmenuContributor.row(
            ReferenceActionsContributor.AddChildId(kind, ref), `${ref.id}@${ref.version}`))
    }

    private versionRows(versions: readonly string[]): readonly CommandDefinition[]
    {
        if (versions.length === 0) return [ReferenceSubmenuContributor.row(ReferenceSubmenuContributor.EmptyId, ReferenceSubmenuContributor.NoOtherVersionsLabel)]
        return versions.map((v) => ReferenceSubmenuContributor.row(ReferenceActionsContributor.SetVersionChildId(v), v))
    }

    // Return the cached rows for this (member, request); on a miss, fetch fire-and-forget and
    // return a Loading row until the next open fills the cache.
    private snapshot(member: SolutionMember, request: string, fetch: () => Promise<readonly CommandDefinition[]>): readonly CommandDefinition[]
    {
        const byRequest = this.cache.get(member) ?? new Map<string, readonly CommandDefinition[]>()
        this.cache.set(member, byRequest)
        const hit = byRequest.get(request)
        if (hit !== undefined) return hit
        void (async () =>
        {
            try { byRequest.set(request, await fetch()) }
            catch { byRequest.set(request, []) }
        })()
        return [ReferenceSubmenuContributor.row(ReferenceSubmenuContributor.LoadingId, ReferenceSubmenuContributor.LoadingLabel)]
    }

    private static row(id: string, title: string): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        return def
    }

    // The disabled command backing a placeholder (Loading… / empty) row.
    public static PlaceholderCommand(commandId: string): ICommand | undefined
    {
        if (commandId === ReferenceSubmenuContributor.EmptyId || commandId === ReferenceSubmenuContributor.LoadingId)
        {
            return new RelayCommand(() => {}, () => false)
        }
        return undefined
    }
}

export default ReferenceActionsContributor
