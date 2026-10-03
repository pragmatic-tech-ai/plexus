import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, ProviderContribution, NodeKey, HierarchyItemsDrop,
    type IHierarchyContributor,
    type HierarchyItem, type HierarchyContribution, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext, type ICommandContributor } from '@pragmatic-tech-ai/mural/framework'
import {
    ProjectContentStore, ContentNodeKey, ProjectNodeKind,
    SolutionMember, SolutionMemberStatus, type ProjectContentNode,
} from '@pragmatic-tech-ai/todl'
import type { ProjectFileFormat } from '../../../projects/project-factory.js'
import type { IContentMutations } from '../../project-explorer/services/content-mutations.js'
import { ProjectHierarchyProvider } from './project-hierarchy-provider.js'
import type { IReferenceView } from './reference-view.js'
import type { IConnectionView } from './connection-view.js'

// Type guard (the `is<X>` free-function house-style exception): a tree row whose ExtObject is
// a solution member, used by MemberOf to find the owning member climbing from any node.
function isMember(x: unknown): x is SolutionMember
{
    return x instanceof SolutionMember
}

// Mounts one ProjectContentProvider (over a lazy, disk-watched ProjectContentStore) per
// resolved member row; an unresolved member is an empty leaf. Also dispatches the file
// context-menu commands for every content node family plus the project row (Add New ▸ /
// New Folder / Import File… / Import Folder… / Rename / Delete). Caches the store + provider
// per member so a repeated Contribute returns the SAME provider instance (the model's
// attachProvider guards re-subscription by identity), and disposes them (releasing the
// chokidar watchers) when a member is pruned or the contributor is torn down.
export class FileTreeContributor implements IHierarchyContributor
{
    private static readonly EmptyLeaf = new NodeContribution([])
    private static readonly AddNewLabel = 'Add New'
    private static readonly NewFolderLabel = 'New Folder'
    private static readonly ImportFileLabel = 'Import File…'
    private static readonly ImportFolderLabel = 'Import Folder…'
    private static readonly RenameLabel = 'Rename'
    private static readonly DeleteLabel = 'Delete'

    public static readonly AddNewId = 'file.addNew'
    public static readonly NewFolderId = 'file.newFolder'
    public static readonly ImportFileId = 'file.importFile'
    public static readonly ImportFolderId = 'file.importFolder'
    public static readonly RenameId = 'file.rename'
    public static readonly DeleteId = 'file.delete'
    // Dynamic child id: `file.addNew::<kind>::<extension>`.
    public static readonly AddNewChildPrefix = 'file.addNew::'
    private static readonly ChildSeparator = '::'
    // Minor 3: AddNewChildId always packs exactly kind + extension on ChildSeparator; a raw
    // value that itself contained the separator would corrupt the decode. Fail loudly instead
    // of silently binding the wrong field — this should never fire for real formats.
    private static readonly SeparatorCollisionMessage = 'FileTreeContributor: a raw id segment contains the child separator'
    private static readonly SegmentCountMessage = 'FileTreeContributor: malformed addNew child id'

    // The node keys this contributor supplies context-menu actions for: every content node
    // family plus the project/member row itself.
    private static readonly ActionKeys = [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project]

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 0

    private readonly stores = new Map<SolutionMember, ProjectContentStore>()
    private readonly providers = new Map<SolutionMember, ProjectHierarchyProvider>()
    private mutations: IContentMutations | undefined
    private referenceView: IReferenceView | undefined
    private connectionView: IConnectionView | undefined

    // The file CommandDefinitions, Context-tagged for every content node family (full set,
    // including Rename/Delete) and for the project row (its file ops target the project root,
    // so Rename/Delete are omitted). Passed to RegisterInstance(this, this.Actions) at
    // rebuild() — the runtime-set mutations façade keeps this off the module DSL path.
    public readonly Actions: readonly CommandDefinition[]

    constructor()
    {
        const actions: CommandDefinition[] = []
        for (const key of FileTreeContributor.ActionKeys)
        {
            const content = key !== NodeKey.Project
            actions.push(FileTreeContributor.addNewCommand(key))
            actions.push(FileTreeContributor.command(FileTreeContributor.NewFolderId, FileTreeContributor.NewFolderLabel, key))
            actions.push(FileTreeContributor.command(FileTreeContributor.ImportFileId, FileTreeContributor.ImportFileLabel, key))
            actions.push(FileTreeContributor.command(FileTreeContributor.ImportFolderId, FileTreeContributor.ImportFolderLabel, key))
            if (content)
            {
                actions.push(FileTreeContributor.command(FileTreeContributor.RenameId, FileTreeContributor.RenameLabel, key, true))
                actions.push(FileTreeContributor.command(FileTreeContributor.DeleteId, FileTreeContributor.DeleteLabel, key))
            }
        }
        this.Actions = actions
    }

    public SetMutations(m: IContentMutations): void { this.mutations = m }
    public SetReferenceView(view: IReferenceView): void { this.referenceView = view }
    public SetConnectionView(view: IConnectionView): void { this.connectionView = view }

    private static command(id: string, title: string, contextKey: string, separatorBefore = false): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Context = HierarchyContext.For(contextKey)
        def.SeparatorBefore = separatorBefore
        return def
    }

    private static addNewCommand(contextKey: string): CommandDefinition
    {
        const def = FileTreeContributor.command(FileTreeContributor.AddNewId, FileTreeContributor.AddNewLabel, contextKey)
        def.ChildrenContributor = AddNewSubmenuContributor.Key
        return def
    }

    public static AddNewChildId(format: ProjectFileFormat): string
    {
        FileTreeContributor.assertNoSeparator(format.kind)
        FileTreeContributor.assertNoSeparator(format.extension)
        return FileTreeContributor.AddNewChildPrefix + [format.kind, format.extension].join(FileTreeContributor.ChildSeparator)
    }

    private static assertNoSeparator(raw: string): void
    {
        if (raw.includes(FileTreeContributor.ChildSeparator))
        {
            throw new Error(`${FileTreeContributor.SeparatorCollisionMessage}: "${raw}"`)
        }
    }

    // The formats a new-file submenu offers for a member — delegates to the mutation façade
    // (empty until mutations are wired). Read by AddNewSubmenuContributor.
    public FormatsFor(member: SolutionMember): readonly ProjectFileFormat[]
    {
        return this.mutations?.FormatsFor(member) ?? []
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const anchor = (context as HierarchyActionContext).Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        const mutations = this.mutations
        if (member === undefined || mutations === undefined) return undefined
        const isProjectRow = anchor.ExtObject === member
        const folder = isProjectRow ? '' : FileTreeContributor.folderOf(anchor)

        if (commandId.startsWith(FileTreeContributor.AddNewChildPrefix))
        {
            const parts = commandId
                .slice(FileTreeContributor.AddNewChildPrefix.length)
                .split(FileTreeContributor.ChildSeparator)
            // Invariant: AddNewChildId always packs exactly 2 segments (kind, extension). A
            // different count means the id was corrupted — fail loudly rather than silently
            // binding the wrong field.
            if (parts.length !== 2)
            {
                throw new Error(`${FileTreeContributor.SegmentCountMessage}: "${commandId}"`)
            }
            const [kind, extension] = parts
            const format = mutations.FormatsFor(member).find((f) => f.kind === kind && f.extension === extension)
            if (format === undefined) return undefined
            return new RelayCommand(() => void mutations.NewFileForMember(member, folder, format))
        }

        switch (commandId)
        {
            case FileTreeContributor.AddNewId:
                return new RelayCommand(() => {})
            case FileTreeContributor.NewFolderId:
                return new RelayCommand(() => void mutations.NewFolderForMember(member, folder, FileTreeContributor.NewFolderLabel))
            case FileTreeContributor.ImportFileId:
                return new RelayCommand(() => void mutations.ImportFilesForMember(member, folder))
            case FileTreeContributor.ImportFolderId:
                return new RelayCommand(() => void mutations.ImportFolderForMember(member, folder))
            case FileTreeContributor.RenameId:
                return new RelayCommand(() => anchor.BeginEdit())
            case FileTreeContributor.DeleteId:
                // Delete is selection-aware (matches the Delete key): the context carries the
                // live selection snapshot, so deleting a row that is part of a multi-selection
                // deletes the whole set under one confirm.
                return new RelayCommand(() => void this.DeleteFrom(anchor, (context as HierarchyActionContext).Selection))
            default:
                return undefined
        }
    }

    // Façade the host calls for inline F2 rename — same mutation path as the menu actions.
    public async RenameNode(vm: HierarchyItem, name: string): Promise<void>
    {
        const member = FileTreeContributor.MemberOf(vm)
        if (member !== undefined && this.mutations !== undefined) await this.mutations.RenameMemberFile(member, (vm.ExtObject as ProjectContentNode).Path, name)
    }

    // The single delete choke point for BOTH the menu action and the Delete key: delete
    // the whole selection when `anchor` is part of it, else just `anchor` — one batch
    // (one confirm) via the mutation façade. The member row itself (no Path) is excluded.
    public async DeleteFrom(anchor: HierarchyItem, selection: readonly HierarchyItem[]): Promise<void>
    {
        const member = FileTreeContributor.MemberOf(anchor)
        if (member === undefined || this.mutations === undefined) return
        const targets = selection.includes(anchor) && selection.length > 0 ? selection : [anchor]
        // Only content rows have a Path: exclude the member row and any non-content row
        // (e.g. a References/group/leaf node caught in a mixed multi-selection) — mapping
        // their Path would pass undefined into the delete.
        const paths = targets
            .filter((vm) => vm.ExtObject !== member)
            .map((vm) => (vm.ExtObject as ProjectContentNode).Path)
            .filter((p): p is string => typeof p === 'string')
        await this.mutations.DeleteMemberFiles(member, paths)
    }

    public CanDrop(target: HierarchyItem, dragged: readonly HierarchyItem[]): boolean
    {
        const member = FileTreeContributor.MemberOf(target)
        const provider = member === undefined ? undefined : this.providers.get(member)
        if (provider === undefined || dragged.length === 0) return false
        if (FileTreeContributor.MemberOf(dragged[0]!) !== member) return false   // same-member only
        return provider.CanAccept(target, HierarchyItemsDrop.For(dragged.map((d) => d.Id)))
    }

    public Drop(target: HierarchyItem, dragged: readonly HierarchyItem[]): void
    {
        const member = FileTreeContributor.MemberOf(target)
        if (member === undefined || this.mutations === undefined) return
        const destPath = target.ExtObject === member ? '' : (target.ExtObject as ProjectContentNode).Path
        void this.mutations.MoveMemberNodes(member, dragged.map((d) => (d.ExtObject as ProjectContentNode).Path), destPath)
    }

    public ProviderFor(member: SolutionMember): ProjectHierarchyProvider | undefined { return this.providers.get(member) }

    // Climb from any row to the solution member that owns its subtree.
    public static MemberOf(vm: HierarchyItem): SolutionMember | undefined
    {
        let cur: HierarchyItem | undefined = vm
        while (cur !== undefined)
        {
            if (isMember(cur.ExtObject)) return cur.ExtObject
            cur = cur.Parent
        }
        return undefined
    }

    // The project-relative folder a new item lands in: the node's own path when it is a
    // folder, else its containing directory.
    private static folderOf(vm: HierarchyItem): string
    {
        const node = vm.ExtObject as ProjectContentNode
        return node.Kind === ProjectNodeKind.Folder ? node.Path : ProjectContentStore.parentDir(node.Path)
    }

    public Contribute(parent: HierarchyItem): HierarchyContribution
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
            provider = new ProjectHierarchyProvider(store)
            this.providers.set(member, provider)
        }
        // The file tree is now just the project's content subtree. References and the global
        // Connections branch are INDEPENDENT peer contributors (ReferencesContributor /
        // ConnectionsRootContributor), no longer woven in as leading branches here.
        return new ProviderContribution(provider)
    }

    // Release one member's store + provider when its row is pruned.
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

// Supplies the "Add New ▸" submenu rows (one per project file format) lazily. FormatsFor is
// synchronous, so the rows are produced directly; behaviour is dispatched by the owning
// FileTreeContributor (these defs carry only Id + Title).
export class AddNewSubmenuContributor implements ICommandContributor
{
    public static readonly Key = new ServiceKey<AddNewSubmenuContributor>('AddNewSubmenuContributor')

    constructor(private readonly host: FileTreeContributor)
    {
    }

    public Contribute(_parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[]
    {
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return []
        return this.host.FormatsFor(member).map((f) =>
        {
            const def = new CommandDefinition()
            def.Id = FileTreeContributor.AddNewChildId(f)
            def.Title = f.displayName
            return def
        })
    }
}
