import {
    NodeContribution, ProviderContribution, NodeKey, HierarchyAction, HierarchyItemsDrop,
    type IHierarchyContributor, type IHierarchyActionContributor,
    type HierarchyNode, type HierarchyContribution, type HierarchyItemVM, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    ProjectContentStore, ProjectContentProvider, ContentNodeKey, ProjectNodeKind,
    SolutionMember, SolutionMemberStatus, type ProjectContentNode,
} from '@pragmatic-tech-ai/todl'
import type { IContentMutations } from '../../project-explorer/services/content-mutations.js'

// Type guard (the `is<X>` free-function house-style exception): a tree row whose Data is
// a solution member, used by MemberOf to find the owning member climbing from any node.
function isMember(x: unknown): x is SolutionMember
{
    return x instanceof SolutionMember
}

// Mounts one ProjectContentProvider (over a lazy, disk-watched ProjectContentStore) per
// resolved member row; an unresolved member is an empty leaf. Caches the store + provider
// per member so a repeated Contribute returns the SAME provider instance (the model's
// attachProvider guards re-subscription by identity), and disposes them (releasing the
// chokidar watchers) when a member is pruned or the contributor is torn down.
export class FileTreeContributor implements IHierarchyContributor, IHierarchyActionContributor
{
    private static readonly EmptyLeaf = new NodeContribution([])
    private static readonly AddNewLabel = 'Add New'
    private static readonly NewFolderLabel = 'New Folder'
    private static readonly ImportFileLabel = 'Import File…'
    private static readonly ImportFolderLabel = 'Import Folder…'
    private static readonly RenameLabel = 'Rename'
    private static readonly DeleteLabel = 'Delete'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 0
    // The node keys this contributor supplies context-menu actions for: every content
    // node family plus the project/member row itself.
    public readonly ActionKeys = [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project]

    private readonly stores = new Map<SolutionMember, ProjectContentStore>()
    private readonly providers = new Map<SolutionMember, ProjectContentProvider>()
    private mutations: IContentMutations | undefined

    public SetMutations(m: IContentMutations): void { this.mutations = m }

    // The base file actions for a content/project row, closing over the resolved member +
    // the mutation façade. New Folder / Add New ▸ format / Import… / Rename / Delete; the
    // project row omits Rename/Delete (its file ops target the project root folder).
    public ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]
    {
        const vm = context.Anchor
        const member = FileTreeContributor.MemberOf(vm)
        const mutations = this.mutations
        if (member === undefined || mutations === undefined) return []
        const isProjectRow = vm.Data === member
        const folder = isProjectRow ? '' : FileTreeContributor.folderOf(vm)
        const out: HierarchyAction[] = []
        const addNew = HierarchyAction.Command(FileTreeContributor.AddNewLabel, () => {})
        for (const f of mutations.FormatsFor(member))
        {
            addNew.Children.Add(HierarchyAction.Command(f.displayName, () => void mutations.NewFileForMember(member, folder, f)))
        }
        out.push(addNew)
        out.push(HierarchyAction.Command(FileTreeContributor.NewFolderLabel, () => void mutations.NewFolderForMember(member, folder, FileTreeContributor.NewFolderLabel)))
        out.push(HierarchyAction.Command(FileTreeContributor.ImportFileLabel, () => void mutations.ImportFilesForMember(member, folder)))
        out.push(HierarchyAction.Command(FileTreeContributor.ImportFolderLabel, () => void mutations.ImportFolderForMember(member, folder)))
        if (!isProjectRow)
        {
            out.push(HierarchyAction.Separator())
            out.push(HierarchyAction.Command(FileTreeContributor.RenameLabel, () => vm.BeginEdit()))
            // Delete is selection-aware (matches the Delete key): the context carries the
            // live selection snapshot, so deleting a row that is part of a multi-selection
            // deletes the whole set under one confirm.
            out.push(HierarchyAction.Command(FileTreeContributor.DeleteLabel, (ctx) => void this.DeleteFrom(ctx.Anchor, ctx.Selection), { context }))
        }
        return out
    }

    // Façade the host calls for inline F2 rename — same mutation path as the menu actions.
    public async RenameNode(vm: HierarchyItemVM, name: string): Promise<void>
    {
        const member = FileTreeContributor.MemberOf(vm)
        if (member !== undefined && this.mutations !== undefined) await this.mutations.RenameMemberFile(member, (vm.Data as ProjectContentNode).Path, name)
    }

    // The single delete choke point for BOTH the menu action and the Delete key: delete
    // the whole selection when `anchor` is part of it, else just `anchor` — one batch
    // (one confirm) via the mutation façade. The member row itself (no Path) is excluded.
    public async DeleteFrom(anchor: HierarchyItemVM, selection: readonly HierarchyItemVM[]): Promise<void>
    {
        const member = FileTreeContributor.MemberOf(anchor)
        if (member === undefined || this.mutations === undefined) return
        const targets = selection.includes(anchor) && selection.length > 0 ? selection : [anchor]
        const paths = targets.filter((vm) => vm.Data !== member).map((vm) => (vm.Data as ProjectContentNode).Path)
        await this.mutations.DeleteMemberFiles(member, paths)
    }

    public CanDrop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): boolean
    {
        const member = FileTreeContributor.MemberOf(target)
        const provider = member === undefined ? undefined : this.providers.get(member)
        if (provider === undefined || dragged.length === 0) return false
        if (FileTreeContributor.MemberOf(dragged[0]!) !== member) return false   // same-member only
        return provider.CanAccept(target.Id, HierarchyItemsDrop.For(dragged.map((d) => d.Id)))
    }

    public Drop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): void
    {
        const member = FileTreeContributor.MemberOf(target)
        if (member === undefined || this.mutations === undefined) return
        const destPath = target.Data === member ? '' : (target.Data as ProjectContentNode).Path
        void this.mutations.MoveMemberNodes(member, dragged.map((d) => (d.Data as ProjectContentNode).Path), destPath)
    }

    public ProviderFor(member: SolutionMember): ProjectContentProvider | undefined { return this.providers.get(member) }

    // Climb from any row to the solution member that owns its subtree.
    public static MemberOf(vm: HierarchyItemVM): SolutionMember | undefined
    {
        let cur: HierarchyItemVM | undefined = vm
        while (cur !== undefined)
        {
            if (isMember(cur.Data)) return cur.Data
            cur = cur.Parent
        }
        return undefined
    }

    // The project-relative folder a new item lands in: the node's own path when it is a
    // folder, else its containing directory.
    private static folderOf(vm: HierarchyItemVM): string
    {
        const node = vm.Data as ProjectContentNode
        return node.Kind === ProjectNodeKind.Folder ? node.Path : ProjectContentStore.parentDir(node.Path)
    }

    public Contribute(parent: HierarchyNode): HierarchyContribution
    {
        const member = parent.ExtObject as SolutionMember
        if (member.Status !== SolutionMemberStatus.Resolved || member.Storage === undefined)
        {
            return FileTreeContributor.EmptyLeaf
        }
        let provider = this.providers.get(member)
        if (provider === undefined)
        {
            const store = new ProjectContentStore(member.Storage)
            this.stores.set(member, store)
            provider = new ProjectContentProvider(store)
            this.providers.set(member, provider)
        }
        return new ProviderContribution(provider)
    }

    // Release one member's store + provider when that member row is pruned.
    public Release(member: SolutionMember): void
    {
        const store = this.stores.get(member)
        if (store !== undefined)
        {
            store.dispose()
            this.stores.delete(member)
        }
        this.providers.delete(member)
    }

    public dispose(): void
    {
        for (const store of this.stores.values()) store.dispose()
        this.stores.clear()
        this.providers.clear()
    }
}
