import { describe, it, expect } from 'vitest'
import {
    NodeKey, NodeSeverity, ProviderContribution, ChildAdded,
    type HierarchyNode, type HierarchyItemVM, type HierarchyChange,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Solution, SolutionMemberStatus, type SolutionMember, type ProjectContentNode, type ProjectFileFormat } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from '../file-tree-contributor.js'
import type { IContentMutations } from '../../../project-explorer/services/content-mutations.js'
import type { ProjectContentProvider } from '@pragmatic-tech-ai/todl'

const tick = () => new Promise((r) => setTimeout(r, 10))

// Records every mutation call; every method a no-op returning the interface's shape.
function fakeMutations(): IContentMutations & { deleted: [SolutionMember, string][]; renamed: [SolutionMember, string, string][] }
{
    const rec = {
        deleted: [] as [SolutionMember, string][],
        renamed: [] as [SolutionMember, string, string][],
        RenameMemberFile: async (m: SolutionMember, p: string, n: string) => { rec.renamed.push([m, p, n]) },
        DeleteMemberFile: async (m: SolutionMember, p: string) => { rec.deleted.push([m, p]) },
        NewFileForMember: async () => {}, NewFolderForMember: async () => {},
        ImportFilesForMember: async () => {}, ImportFolderForMember: async () => {},
        MoveMemberNodes: async () => {}, PublishMember: async () => {},
        BumpMemberVersion: async () => {}, SetMemberVersion: async () => {},
        ManageMemberReferences: async () => {}, RefreshMemberBases: () => {},
        UpdateMemberAgentMetadata: async () => {}, CloseMember: async () => {},
        FormatsFor: (): readonly ProjectFileFormat[] => [], IsVersionedMember: () => false,
        CanRefreshBasesMember: () => false, SupportsScaffoldMember: () => false,
    }
    return rec
}

function memberNode(ext: unknown): HierarchyNode
{
    return { Key: NodeKey.Project, Caption: 'p', IconKey: NodeKey.Project, ExtObject: ext, Severity: NodeSeverity.Ok }
}

function fakeVm(data: unknown, parent: HierarchyItemVM | undefined, id: unknown): HierarchyItemVM
{
    return { Data: data, Parent: parent, Id: id } as unknown as HierarchyItemVM
}

async function fileHarness()
{
    const s = new FakeStorage()
    await s.CreateDirectory('dir')
    await s.WriteText('a.todl', '')
    const sol = new Solution('S')
    const member = sol.AddMember('./p', 'architecture')
    member.Status = SolutionMemberStatus.Resolved
    member.Storage = s

    const contributor = new FileTreeContributor()
    const mutations = fakeMutations()
    contributor.SetMutations(mutations)
    const provider = (contributor.Contribute(memberNode(member)) as ProviderContribution).Provider as unknown as ProjectContentProvider
    const byPath = new Map<string, { Id: unknown; Data: ProjectContentNode }>()
    provider.ObserveChildren(provider.ParseCanonicalName(''), (c: HierarchyChange) =>
    { if (c instanceof ChildAdded) byPath.set((c.Node.ExtObject as ProjectContentNode).Path, { Id: c.Id, Data: c.Node.ExtObject as ProjectContentNode }) })
    await tick()

    const memberRowVm = fakeVm(member, undefined, undefined)
    const folderVm = fakeVm(byPath.get('dir')!.Data, memberRowVm, byPath.get('dir')!.Id)
    const fileVm = fakeVm(byPath.get('a.todl')!.Data, memberRowVm, byPath.get('a.todl')!.Id)
    return { contributor, member, memberRowVm, folderVm, fileVm, mutations }
}

describe('FileTreeContributor actions + façade', () =>
{
    it('Delete action runs the close-guard path via mutations (not the store directly)', async () =>
    {
        const { contributor, member, fileVm, mutations } = await fileHarness()
        const del = contributor.ActionsFor(fileVm).find((a) => a.Label === 'Delete')!
        del.Invoke.Execute()
        await Promise.resolve()
        expect(mutations.deleted.at(-1)).toEqual([member, 'a.todl'])
    })

    it('CanDrop delegates to the member provider CanAccept', async () =>
    {
        const { contributor, folderVm, fileVm } = await fileHarness()
        expect(contributor.CanDrop(folderVm, [fileVm])).toBe(true)
        expect(contributor.CanDrop(fileVm, [fileVm])).toBe(false)   // target not a folder
    })
})
