import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { Solution, type SolutionMember, type ProjectFileFormat } from '@pragmatic-tech-ai/todl'
import { ProjectActionsContributor } from '../project-actions-contributor.js'
import type { IContentMutations } from '../../../project-explorer/services/content-mutations.js'

// A fake hierarchy row the contributor reads to climb to its owning member: a project row
// carries the member itself as its ExtObject (what FileTreeContributor.MemberOf matches).
class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown, parent?: FakeItem)
    {
        this.Parent = parent
    }
}

function fakeMutations(over: Partial<IContentMutations> = {}): IContentMutations & { removed: SolutionMember[]; bumped: SolutionMember[] }
{
    const rec = {
        removed: [] as SolutionMember[],
        bumped: [] as SolutionMember[],
        RenameMemberFile: async () => {}, DeleteMemberFiles: async () => {},
        NewFileForMember: async () => {}, NewFolderForMember: async () => {},
        ImportFilesForMember: async () => {}, ImportFolderForMember: async () => {},
        MoveMemberNodes: async () => {}, PublishMember: async () => {},
        BumpMemberVersion: async (m: SolutionMember) => { rec.bumped.push(m) }, SetMemberVersion: async () => {},
        ManageMemberReferences: async () => {}, RefreshMemberBases: () => {},
        UpdateMemberAgentMetadata: async () => {}, CloseMember: async () => {},
        RemoveMember: async (m: SolutionMember) => { rec.removed.push(m) },
        FormatsFor: (): readonly ProjectFileFormat[] => [], IsVersionedMember: () => false,
        CanRefreshBasesMember: () => false, SupportsScaffoldMember: () => false,
        ...over,
    }
    return rec as IContentMutations & { removed: SolutionMember[]; bumped: SolutionMember[] }
}

function memberRow(member: SolutionMember): HierarchyItem
{
    return new FakeItem(NodeKey.Project, member) as unknown as HierarchyItem
}

function ctxFor(anchor: HierarchyItem): HierarchyActionContext
{
    return new HierarchyActionContext(anchor, [anchor])
}

function someMember(): SolutionMember
{
    return new Solution('S').AddMember('./p', 'architecture')
}

describe('ProjectActionsContributor', () =>
{
    it('declares the project-row commands, each Context-tagged to NodeKey.Project', () =>
    {
        const c = new ProjectActionsContributor(fakeMutations())
        const titles = c.Actions.map((a) => a.Title)
        expect(titles).toEqual(expect.arrayContaining(['Remove from Solution', 'Bump Version', 'Set Version…', 'Manage References…', 'Refresh Bases', 'Update Agent Metadata']))
        expect(c.Actions.every((a) => a.Context === HierarchyContext.For(NodeKey.Project))).toBe(true)
    })

    it('Remove from Solution resolves to a command that routes to mutations.RemoveMember with the row member', () =>
    {
        const member = someMember()
        const m = fakeMutations()
        const c = new ProjectActionsContributor(m)
        c.Resolve(ProjectActionsContributor.RemoveId, ctxFor(memberRow(member)))!.Execute()
        expect(m.removed.at(-1)).toBe(member)
    })

    it('Bump (Major) is executable only for a versioned member, and routes to BumpMemberVersion', () =>
    {
        const member = someMember()
        const versioned = fakeMutations({ IsVersionedMember: () => true })
        const plain = new ProjectActionsContributor(fakeMutations({ IsVersionedMember: () => false }))
        const row = memberRow(member)
        expect(plain.Resolve(ProjectActionsContributor.BumpMajorId, ctxFor(row))!.CanExecute()).toBe(false)
        const c = new ProjectActionsContributor(versioned)
        const bump = c.Resolve(ProjectActionsContributor.BumpMajorId, ctxFor(row))!
        expect(bump.CanExecute()).toBe(true)
        bump.Execute()
        expect(versioned.bumped.at(-1)).toBe(member)
    })

    it('Manage References… + Refresh Bases are gated on CanRefreshBasesMember', () =>
    {
        const member = someMember()
        const gated = new ProjectActionsContributor(fakeMutations({ CanRefreshBasesMember: () => false }))
        const open = new ProjectActionsContributor(fakeMutations({ CanRefreshBasesMember: () => true }))
        const row = memberRow(member)
        expect(gated.Resolve(ProjectActionsContributor.ManageReferencesId, ctxFor(row))!.CanExecute()).toBe(false)
        expect(gated.Resolve(ProjectActionsContributor.RefreshBasesId, ctxFor(row))!.CanExecute()).toBe(false)
        expect(open.Resolve(ProjectActionsContributor.ManageReferencesId, ctxFor(row))!.CanExecute()).toBe(true)
        expect(open.Resolve(ProjectActionsContributor.RefreshBasesId, ctxFor(row))!.CanExecute()).toBe(true)
    })

    it('resolves nothing for a row that has no owning member', () =>
    {
        const c = new ProjectActionsContributor(fakeMutations())
        const orphan = new FakeItem(NodeKey.Project, { notAMember: true }) as unknown as HierarchyItem
        expect(c.Resolve(ProjectActionsContributor.RemoveId, ctxFor(orphan))).toBeUndefined()
    })
})
