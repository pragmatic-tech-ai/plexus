import { describe, it, expect } from 'vitest'
import { NodeKey, type HierarchyActionContext, type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, SolutionMember } from '@pragmatic-tech-ai/todl'
import { ReferenceActionsContributor } from '../reference-actions-contributor.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import type { IReferenceView } from '../reference-view.js'
import type { BaseRef } from '../../../../projects/base-binding.js'

const tick = () => new Promise((r) => setTimeout(r, 10))
const member = new SolutionMember({ path: 'p', type: 'architecture' })

// A fake IReferenceView recording mutator calls, with stub read methods.
function fakeView(overrides: Partial<IReferenceView> = {}): IReferenceView & { removed: [ProjectType, string][]; added: [ProjectType, string][]; versioned: [ProjectType, string, string][] }
{
    const removed: [ProjectType, string][] = []
    const added: [ProjectType, string][] = []
    const versioned: [ProjectType, string, string][] = []
    const base = {
        removed, added, versioned,
        ReferencesViewFor: async () => undefined,
        AvailableReferencesFor: async (): Promise<readonly BaseRef[]> => [{ id: 'core', version: '1.0.0' }],
        AvailableVersionsFor: async (): Promise<readonly string[]> => ['1.1.0', '1.0.0'],
        AddMemberReference: async (_m: SolutionMember, k: ProjectType, r: BaseRef) => { added.push([k, r.id]) },
        RemoveMemberReference: async (_m: SolutionMember, k: ProjectType, r: BaseRef) => { removed.push([k, r.id]) },
        SetMemberReferenceVersion: async (_m: SolutionMember, k: ProjectType, id: string, v: string) => { versioned.push([k, id, v]) },
        OnReferencesViewChanged: () => ({ dispose() {} }),
    }
    return Object.assign(base, overrides)
}

// A minimal HierarchyItemVM stand-in: Key + Data (+ Parent for MemberOf to climb).
function vm(key: string, data: unknown, parent?: HierarchyItemVM): HierarchyItemVM
{
    return { Key: key, Data: data, Parent: parent } as unknown as HierarchyItemVM
}
// Give a row a project parent whose Data is the real member, so MemberOf resolves it.
function withMember(v: HierarchyItemVM): HierarchyItemVM
{
    return vm(v.Key, (v as unknown as { Data: unknown }).Data, vm(NodeKey.Project, member))
}
const ctx = (anchor: HierarchyItemVM, selection: HierarchyItemVM[] = [anchor]): HierarchyActionContext => ({ Anchor: anchor, Selection: selection })

describe('ReferenceActionsContributor', () =>
{
    it('the References node offers Add Meta-model', () =>
    {
        const c = new ReferenceActionsContributor(fakeView())
        const actions = c.ActionsFor(ctx(withMember(vm(NodeKey.References, {}))))
        expect(actions.map((a) => a.Label)).toContain('Add Meta-model')
    })

    it('a group node offers Add for its kind, populated from the available set', async () =>
    {
        const c = new ReferenceActionsContributor(fakeView())
        const add = c.ActionsFor(ctx(withMember(vm(ReferenceNodeKey.Group, { group: ProjectType.MetaModel })))).find((a) => a.Label === 'Add')!
        expect(add).toBeDefined()
        await tick()
        expect(add.Children.Count).toBe(1)
        expect(add.Children.Get(0)!.Label).toBe('core@1.0.0')
    })

    it('a leaf offers Set Version and Remove', () =>
    {
        const c = new ReferenceActionsContributor(fakeView())
        const actions = c.ActionsFor(ctx(withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } }))))
        expect(actions.map((a) => a.Label)).toEqual(expect.arrayContaining(['Set Version', 'Remove']))
    })

    it('Remove on a multi-selected leaf removes the whole selection, each from its kind', async () =>
    {
        const v = fakeView()
        const c = new ReferenceActionsContributor(v)
        const a = withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } }))
        const b = withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.Library, ref: { id: 'ui', version: '2.0.0' } }))
        const remove = c.ActionsFor(ctx(a, [a, b])).find((x) => x.Label === 'Remove')!
        remove.Invoke.Execute()
        await tick()
        expect(v.removed.sort()).toEqual([[ProjectType.Library, 'ui'], [ProjectType.MetaModel, 'core']])
    })

    it('an empty Add submenu shows a single disabled item', async () =>
    {
        const c = new ReferenceActionsContributor(fakeView({ AvailableReferencesFor: async () => [] }))
        const add = c.ActionsFor(ctx(withMember(vm(ReferenceNodeKey.Group, { group: ProjectType.MetaModel })))).find((a) => a.Label === 'Add')!
        await tick()
        expect(add.Children.Count).toBe(1)
        expect(add.Children.Get(0)!.Invoke.CanExecute()).toBe(false)
    })

    it('Set Version submenu marks the current version non-executable', async () =>
    {
        const c = new ReferenceActionsContributor(fakeView())
        const leaf = withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } }))
        const setV = c.ActionsFor(ctx(leaf)).find((a) => a.Label === 'Set Version')!
        await tick()
        const current = [...Array(setV.Children.Count).keys()].map((i) => setV.Children.Get(i)!).find((x) => x.Label === '1.0.0')!
        expect(current.Invoke.CanExecute()).toBe(false)   // already the pinned version
    })
})
