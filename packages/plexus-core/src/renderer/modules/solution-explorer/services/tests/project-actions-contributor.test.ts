import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution, type SolutionMember, type ProjectFileFormat } from '@pragmatic-tech-ai/todl'
import { ProjectActionsContributor } from '../project-actions-contributor.js'
import type { IContentMutations } from '../../../project-explorer/services/content-mutations.js'

function fakeMutations(over: Partial<IContentMutations> = {}): IContentMutations & { closed: SolutionMember[] }
{
    const rec = {
        closed: [] as SolutionMember[],
        RenameMemberFile: async () => {}, DeleteMemberFiles: async () => {},
        NewFileForMember: async () => {}, NewFolderForMember: async () => {},
        ImportFilesForMember: async () => {}, ImportFolderForMember: async () => {},
        MoveMemberNodes: async () => {}, PublishMember: async () => {},
        BumpMemberVersion: async () => {}, SetMemberVersion: async () => {},
        ManageMemberReferences: async () => {}, RefreshMemberBases: () => {},
        UpdateMemberAgentMetadata: async () => {},
        CloseMember: async (m: SolutionMember) => { rec.closed.push(m) },
        FormatsFor: (): readonly ProjectFileFormat[] => [], IsVersionedMember: () => false,
        CanRefreshBasesMember: () => false, SupportsScaffoldMember: () => false,
        ...over,
    }
    return rec as IContentMutations & { closed: SolutionMember[] }
}

function memberRowVm(member: SolutionMember): HierarchyItemVM
{
    return { Data: member, Parent: undefined, Key: NodeKey.Project, Severity: NodeSeverity.Ok } as unknown as HierarchyItemVM
}

// The menu-open context a contributor now receives (anchor row + selection snapshot).
function ctxFor(vm: HierarchyItemVM): { Anchor: HierarchyItemVM; Selection: readonly HierarchyItemVM[] }
{
    return { Anchor: vm, Selection: [vm] }
}

function someMember(): SolutionMember
{
    return new Solution('S').AddMember('./p', 'architecture')
}

describe('ProjectActionsContributor', () =>
{
    it('Publish is present + enabled only for a versioned member', () =>
    {
        const member = someMember()
        const versioned = new ProjectActionsContributor(fakeMutations({ IsVersionedMember: () => true }))
        const plain = new ProjectActionsContributor(fakeMutations({ IsVersionedMember: () => false }))
        const vm = memberRowVm(member)
        expect(versioned.ActionsFor(ctxFor(vm)).find((a) => a.Label === 'Publish')!.Invoke.CanExecute()).toBe(true)
        expect(plain.ActionsFor(ctxFor(vm)).find((a) => a.Label === 'Publish')!.Invoke.CanExecute()).toBe(false)
    })

    it('Close routes to mutations.CloseMember with the row member', () =>
    {
        const member = someMember()
        const m = fakeMutations()
        new ProjectActionsContributor(m).ActionsFor(ctxFor(memberRowVm(member))).find((a) => a.Label === 'Close Project')!.Invoke.Execute()
        expect(m.closed.at(-1)).toBe(member)
    })
})
