import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { Solution, type SolutionMember, type BuildService } from '@pragmatic-tech-ai/todl'
import { BuildContributor } from '../build-contributor.js'
import type { IContentMutations } from '../../../project-explorer/services/content-mutations.js'

// A fake project row: it carries its member as ExtObject (what FileTreeContributor.MemberOf
// matches when BuildContributor.Resolve climbs to the owning member).
class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown, parent?: FakeItem)
    {
        this.Parent = parent
    }
}

function fakeMutations(over: Partial<IContentMutations> = {}): IContentMutations & { published: SolutionMember[] }
{
    const rec = {
        published: [] as SolutionMember[],
        RenameMemberFile: async () => {}, DeleteMemberFiles: async () => {},
        NewFileForMember: async () => {}, NewFolderForMember: async () => {},
        ImportFilesForMember: async () => {}, ImportFolderForMember: async () => {},
        MoveMemberNodes: async () => {},
        PublishMember: async (m: SolutionMember) => { rec.published.push(m) },
        BumpMemberVersion: async () => {}, SetMemberVersion: async () => {},
        ManageMemberReferences: async () => {}, RefreshMemberBases: () => {},
        UpdateMemberAgentMetadata: async () => {}, CloseMember: async () => {}, RemoveMember: async () => {},
        FormatsFor: () => [], IsVersionedMember: () => false,
        CanRefreshBasesMember: () => false, SupportsScaffoldMember: () => false,
        ...over,
    }
    return rec as IContentMutations & { published: SolutionMember[] }
}

function memberRow(member: SolutionMember): HierarchyItem
{
    return new FakeItem(NodeKey.Project, member) as unknown as HierarchyItem
}

function ctxFor(anchor: HierarchyItem): HierarchyActionContext
{
    return new HierarchyActionContext(anchor, [anchor])
}

const noBuild = {} as unknown as BuildService

function someMember(): SolutionMember
{
    return new Solution('S').AddMember('./p', 'architecture')
}

describe('BuildContributor', () =>
{
    it('contributes Build ▸ and Publish on the project row, Context-tagged to NodeKey.Project', () =>
    {
        const c = new BuildContributor(noBuild, undefined, fakeMutations())
        const titles = c.Actions.map((a) => a.Title)
        expect(titles).toContain('Build')
        expect(titles).toContain('Publish')
        expect(c.Actions.every((a) => a.Context === HierarchyContext.For(NodeKey.Project))).toBe(true)
    })

    it('Publish is executable only for a versioned member and routes to mutations.PublishMember', () =>
    {
        const member = someMember()
        const versioned = fakeMutations({ IsVersionedMember: () => true })
        const plain = new BuildContributor(noBuild, undefined, fakeMutations({ IsVersionedMember: () => false }))
        const row = memberRow(member)
        expect(plain.Resolve(BuildContributor.PublishId, ctxFor(row))!.CanExecute()).toBe(false)
        const c = new BuildContributor(noBuild, undefined, versioned)
        const publish = c.Resolve(BuildContributor.PublishId, ctxFor(row))!
        expect(publish.CanExecute()).toBe(true)
        publish.Execute()
        expect(versioned.published.at(-1)).toBe(member)
    })

    it('the Build ▸ menu header is always openable; its flavor children do the work', () =>
    {
        const c = new BuildContributor(noBuild, undefined, fakeMutations())
        const header = c.Resolve(BuildContributor.BuildMenuId, ctxFor(memberRow(someMember())))!
        expect(header.CanExecute()).toBe(true)
    })

    it('resolves nothing for a row with no owning member', () =>
    {
        const c = new BuildContributor(noBuild, undefined, fakeMutations())
        const orphan = new FakeItem(NodeKey.Project, { notAMember: true }) as unknown as HierarchyItem
        expect(c.Resolve(BuildContributor.PublishId, ctxFor(orphan))).toBeUndefined()
    })
})
