import { describe, it, expect } from 'vitest'
import {
    NodeKey, NodeSeverity, ProviderContribution,
    HierarchyActionContext,
    type HierarchyItem, type HierarchyItemInit, type IRealizeContext, type ItemId,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    Solution, SolutionMemberStatus, ProjectContentNode, ProjectNodeKind,
    type SolutionMember, type ProjectFileFormat,
} from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from '../file-tree-contributor.js'
import type { ProjectHierarchyProvider } from '../project-hierarchy-provider.js'
import type { IContentMutations } from '../content-mutations.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

// A store node id (the brand is a compile-time tag only).
function contentId(raw: string): ProjectContentNode['Id']
{
    return raw as unknown as ProjectContentNode['Id']
}

// A fake HierarchyItem: identity + Key + ExtObject (+ Parent so MemberOf can climb). Content
// rows carry their ProjectContentNode as ExtObject; the project row carries the member.
class FakeItem
{
    public Caption = ''
    public IconKey = ''
    public Parent: FakeItem | undefined

    constructor(public readonly Id: ItemId, public readonly Key: string, public ExtObject: unknown, parent?: FakeItem)
    {
        this.Parent = parent
    }
}

// A fake IRealizeContext that mints FakeItems parented to the realizing item and records the
// realized child set — the provider's content items are bound through it, so CanAccept and
// MemberOf resolve exactly as under the real Hierarchy.
class FakeContext implements IRealizeContext
{
    public readonly Children: FakeItem[] = []
    private next = 1

    constructor(private readonly parent: FakeItem)
    {
    }

    public NewItem(key: string, init?: HierarchyItemInit): HierarchyItem
    {
        const item = new FakeItem(this.next++ as ItemId, key, init?.ExtObject, this.parent)
        item.Caption = init?.Caption ?? ''
        item.IconKey = init?.IconKey ?? ''
        return item as unknown as HierarchyItem
    }

    public InsertChild(child: HierarchyItem): void
    {
        const item = child as unknown as FakeItem
        if (!this.Children.includes(item)) this.Children.push(item)
    }

    public RemoveChild(child: HierarchyItem): void
    {
        const at = this.Children.indexOf(child as unknown as FakeItem)
        if (at >= 0) this.Children.splice(at, 1)
    }
}

// Records every mutation call; every other method a no-op returning the interface's shape.
function fakeMutations(): IContentMutations & { deleted: [SolutionMember, string][]; renamed: [SolutionMember, string, string][] }
{
    const rec = {
        deleted: [] as [SolutionMember, string][],
        renamed: [] as [SolutionMember, string, string][],
        RenameMemberFile: async (m: SolutionMember, p: string, n: string) => { rec.renamed.push([m, p, n]) },
        DeleteMemberFiles: async (m: SolutionMember, ps: readonly string[]) => { for (const p of ps) rec.deleted.push([m, p]) },
        NewFileForMember: async () => {}, NewFolderForMember: async () => {},
        ImportFilesForMember: async () => {}, ImportFolderForMember: async () => {},
        MoveMemberNodes: async () => {}, EnsureMemberGenerated: async () => {}, PublishMember: async () => {},
        BumpMemberVersion: async () => {}, SetMemberVersion: async () => {},
        ManageMemberReferences: async () => {}, RefreshMemberBases: () => {},
        UpdateMemberAgentMetadata: async () => {}, CloseMember: async () => {}, RemoveMember: async () => {},
        FormatsFor: (): readonly ProjectFileFormat[] => [], IsVersionedMember: () => false,
        CanRefreshBasesMember: () => false, SupportsScaffoldMember: () => false,
    }
    return rec
}

function resolvedMember(sol: Solution, storage: FakeStorage): SolutionMember
{
    const m = sol.AddMember('./p', 'architecture')
    m.Status = SolutionMemberStatus.Resolved
    m.Storage = storage
    return m
}

function memberRow(member: SolutionMember): FakeItem
{
    return new FakeItem(0 as ItemId, NodeKey.Project, member)
}

const ctx = (anchor: FakeItem, selection: FakeItem[] = [anchor]): HierarchyActionContext =>
    new HierarchyActionContext(anchor as unknown as HierarchyItem, selection as unknown as HierarchyItem[])

// Realize a resolved member's content subtree off a real FakeStorage (a dir + one file), and
// return the contributor plus the folder/file rows the provider bound (same instances the
// provider's CanAccept answers over).
async function fileHarness()
{
    const s = new FakeStorage()
    await s.CreateDirectory('dir')
    await s.WriteText('a.todl', '')
    const sol = new Solution('S')
    const member = resolvedMember(sol, s)

    const contributor = new FileTreeContributor()
    const mutations = fakeMutations()
    contributor.SetMutations(mutations)

    const row = memberRow(member)
    const provider = (contributor.Contribute(row as unknown as HierarchyItem) as ProviderContribution).Provider as ProjectHierarchyProvider
    const mountCtx = new FakeContext(row)
    provider.Realize(row as unknown as HierarchyItem, mountCtx)
    await tick()

    const byPath = new Map<string, FakeItem>()
    for (const item of mountCtx.Children) byPath.set((item.ExtObject as ProjectContentNode).Path, item)
    return { contributor, member, memberRowVm: row, folderVm: byPath.get('dir')!, fileVm: byPath.get('a.todl')!, mutations }
}

// Build a content row directly (no store), parented to the member row.
function contentRow(member: SolutionMember, name: string, kind: ProjectNodeKind): FakeItem
{
    return new FakeItem(99 as ItemId, name === 'dir' ? 'folder' : 'file', new ProjectContentNode(contentId(name), name, name, kind), memberRow(member))
}

describe('FileTreeContributor actions + façade', () =>
{
    it('Delete action runs the close-guard path via mutations (not the store directly)', async () =>
    {
        const member = new Solution('S').AddMember('./p', 'architecture')
        const contributor = new FileTreeContributor()
        const mutations = fakeMutations()
        contributor.SetMutations(mutations)
        const fileVm = contentRow(member, 'a.todl', ProjectNodeKind.Todl)
        contributor.Resolve(FileTreeContributor.DeleteId, ctx(fileVm))!.Execute()
        await tick()
        expect(mutations.deleted.at(-1)).toEqual([member, 'a.todl'])
    })

    it('Delete on a row that is part of a multi-selection deletes the whole selection', async () =>
    {
        const member = new Solution('S').AddMember('./p', 'architecture')
        const contributor = new FileTreeContributor()
        const mutations = fakeMutations()
        contributor.SetMutations(mutations)
        const fileVm = contentRow(member, 'a.todl', ProjectNodeKind.Todl)
        const folderVm = contentRow(member, 'dir', ProjectNodeKind.Folder)
        contributor.Resolve(FileTreeContributor.DeleteId, ctx(fileVm, [fileVm, folderVm]))!.Execute()
        await tick()
        expect(mutations.deleted).toEqual([[member, 'a.todl'], [member, 'dir']])
    })

    it('Delete skips a non-content row (a References/group/leaf) caught in a multi-selection', async () =>
    {
        const member = new Solution('S').AddMember('./p', 'architecture')
        const contributor = new FileTreeContributor()
        const mutations = fakeMutations()
        contributor.SetMutations(mutations)
        const fileVm = contentRow(member, 'a.todl', ProjectNodeKind.Todl)
        // A synthetic reference row: its ExtObject has no Path (unlike a content node). It must
        // be dropped, never mapped to an undefined path passed into the delete.
        const refNode = new FakeItem(50 as ItemId, NodeKey.References, { references: true }, memberRow(member))
        await contributor.DeleteFrom(fileVm as unknown as HierarchyItem, [fileVm, refNode] as unknown as HierarchyItem[])
        await tick()
        expect(mutations.deleted).toEqual([[member, 'a.todl']])   // only the real file
    })

    it('Rename resolves to a command that begins inline edit on the row', async () =>
    {
        const member = new Solution('S').AddMember('./p', 'architecture')
        const contributor = new FileTreeContributor()
        contributor.SetMutations(fakeMutations())
        let edited = false
        const fileVm = contentRow(member, 'a.todl', ProjectNodeKind.Todl) as unknown as { BeginEdit: () => void }
        fileVm.BeginEdit = () => { edited = true }
        contributor.Resolve(FileTreeContributor.RenameId, ctx(fileVm as unknown as FakeItem))!.Execute()
        expect(edited).toBe(true)
    })

    it('CanDrop delegates to the member provider CanAccept (folder accepts, file rejects)', async () =>
    {
        const { contributor, folderVm, fileVm } = await fileHarness()
        expect(contributor.CanDrop(folderVm as unknown as HierarchyItem, [fileVm] as unknown as HierarchyItem[])).toBe(true)
        expect(contributor.CanDrop(fileVm as unknown as HierarchyItem, [fileVm] as unknown as HierarchyItem[])).toBe(false)   // target not a folder
        contributor.dispose()
    })

    it('a resolved member yields a cached provider — the SAME instance across repeated Contribute', async () =>
    {
        const { contributor, member } = await fileHarness()
        const first = (contributor.Contribute(memberRow(member) as unknown as HierarchyItem) as ProviderContribution).Provider
        const again = (contributor.Contribute(memberRow(member) as unknown as HierarchyItem) as ProviderContribution).Provider
        expect(again).toBe(first)   // identity cached (the Hierarchy's attachProvider guards by identity)
        contributor.dispose()
    })
})
