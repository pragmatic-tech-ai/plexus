import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import type { CommandDefinition } from '@pragmatic-tech-ai/mural/framework'
import { ProjectType, SolutionMember } from '@pragmatic-tech-ai/todl'
import { ReferenceActionsContributor, ReferenceSubmenuContributor } from '../reference-actions-contributor.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import type { IReferenceView } from '../reference-view.js'
import type { BaseRef } from '../../../../projects/base-binding.js'

const tick = () => new Promise((r) => setTimeout(r, 10))
const member = new SolutionMember({ path: 'p', type: 'architecture' })

// A fake IReferenceView recording mutator calls, with stub read methods.
function fakeView(overrides: Partial<IReferenceView> = {}): IReferenceView & { removed: [SolutionMember, ProjectType, string][]; added: [ProjectType, string][]; versioned: [ProjectType, string, string][] }
{
    const removed: [SolutionMember, ProjectType, string][] = []
    const added: [ProjectType, string][] = []
    const versioned: [ProjectType, string, string][] = []
    const base = {
        removed, added, versioned,
        IsConsumer: () => true,
        ReferencesViewFor: async () => undefined,
        AvailableReferencesFor: async (): Promise<readonly BaseRef[]> => [{ id: 'core', version: '1.0.0' }],
        AvailableVersionsFor: async (): Promise<readonly string[]> => ['1.1.0', '1.0.0'],
        AddMemberReference: async (_m: SolutionMember, k: ProjectType, r: BaseRef) => { added.push([k, r.id]) },
        RemoveMemberReference: async (m: SolutionMember, k: ProjectType, r: BaseRef) => { removed.push([m, k, r.id]) },
        SetMemberReferenceVersion: async (_m: SolutionMember, k: ProjectType, id: string, v: string) => { versioned.push([k, id, v]) },
        OnReferencesViewChanged: () => ({ dispose() {} }),
    }
    return Object.assign(base, overrides)
}

// A minimal hierarchy row: Key + ExtObject (+ Parent for MemberOf to climb).
class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown, parent?: FakeItem)
    {
        this.Parent = parent
    }
}

const rowUnder = (owner: SolutionMember, key: string, ext: unknown): HierarchyItem =>
    new FakeItem(key, ext, new FakeItem(NodeKey.Project, owner)) as unknown as HierarchyItem

const ctx = (anchor: HierarchyItem, selection: HierarchyItem[] = [anchor]): HierarchyActionContext => new HierarchyActionContext(anchor, selection)

function defById(c: ReferenceActionsContributor, id: string): CommandDefinition
{
    return c.Actions.find((a) => a.Id === id)!
}

function leafTitles(c: ReferenceActionsContributor): string[]
{
    return c.Actions.filter((a) => a.Context === HierarchyContext.For(ReferenceNodeKey.Leaf)).map((a) => a.Title)
}

describe('ReferenceActionsContributor', () =>
{
    it('the References node offers Add Meta-model', () =>
    {
        const c = new ReferenceActionsContributor(fakeView())
        const add = c.Actions.find((a) => a.Context === HierarchyContext.For(NodeKey.References))!
        expect(add.Title).toBe('Add Meta-model')
        expect(add.ChildrenContributor).toBe(ReferenceSubmenuContributor.Key)
    })

    it('a group node offers Add for its kind, populated from the available set', async () =>
    {
        const v = fakeView()
        const c = new ReferenceActionsContributor(v)
        const submenu = new ReferenceSubmenuContributor(v)
        const addDef = defById(c, ReferenceActionsContributor.AddGroupId)
        const anchor = rowUnder(member, ReferenceNodeKey.Group, { group: ProjectType.MetaModel })
        expect(submenu.Contribute(addDef, ctx(anchor)).map((d) => d.Title)).toEqual(['Loading…'])
        await tick()
        const rows = submenu.Contribute(addDef, ctx(anchor))
        expect(rows.length).toBe(1)
        expect(rows[0]!.Title).toBe('core@1.0.0')
        c.Resolve(rows[0]!.Id, ctx(anchor))!.Execute()
        await tick()
        expect(v.added).toEqual([[ProjectType.MetaModel, 'core']])
    })

    it('a leaf offers Set Version and Remove', () =>
    {
        const c = new ReferenceActionsContributor(fakeView())
        expect(leafTitles(c)).toEqual(expect.arrayContaining(['Set Version', 'Remove']))
    })

    it('Remove on a multi-selected leaf removes the whole selection, each from its kind', async () =>
    {
        const v = fakeView()
        const c = new ReferenceActionsContributor(v)
        const a = rowUnder(member, ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } })
        const b = rowUnder(member, ReferenceNodeKey.Leaf, { kind: ProjectType.Library, ref: { id: 'ui', version: '2.0.0' } })
        c.Resolve(ReferenceActionsContributor.RemoveId, ctx(a, [a, b]))!.Execute()
        await tick()
        expect(v.removed.map(([, k, id]) => [k, id]).sort()).toEqual([[ProjectType.Library, 'ui'], [ProjectType.MetaModel, 'core']])
    })

    it('Remove across a selection spanning two projects removes each ref from its OWN member', async () =>
    {
        const v = fakeView()
        const c = new ReferenceActionsContributor(v)
        const member2 = new SolutionMember({ path: 'q', type: 'architecture' })
        const a = rowUnder(member, ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } })
        const b = rowUnder(member2, ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'shared', version: '2.0.0' } })
        c.Resolve(ReferenceActionsContributor.RemoveId, ctx(a, [a, b]))!.Execute()
        await tick()
        expect(v.removed).toContainEqual([member, ProjectType.MetaModel, 'core'])
        expect(v.removed).toContainEqual([member2, ProjectType.MetaModel, 'shared'])   // its own member, not the anchor's
    })

    it('an empty Add submenu shows a single disabled item', async () =>
    {
        const v = fakeView({ AvailableReferencesFor: async () => [] })
        const c = new ReferenceActionsContributor(v)
        const submenu = new ReferenceSubmenuContributor(v)
        const addDef = defById(c, ReferenceActionsContributor.AddGroupId)
        const anchor = rowUnder(member, ReferenceNodeKey.Group, { group: ProjectType.MetaModel })
        submenu.Contribute(addDef, ctx(anchor))
        await tick()
        const rows = submenu.Contribute(addDef, ctx(anchor))
        expect(rows.length).toBe(1)
        expect(c.Resolve(rows[0]!.Id, ctx(anchor))!.CanExecute()).toBe(false)
    })

    it('Set Version submenu marks the current version non-executable', async () =>
    {
        const v = fakeView()
        const c = new ReferenceActionsContributor(v)
        const submenu = new ReferenceSubmenuContributor(v)
        const setVDef = defById(c, ReferenceActionsContributor.SetVersionId)
        const anchor = rowUnder(member, ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } })
        submenu.Contribute(setVDef, ctx(anchor))
        await tick()
        const rows = submenu.Contribute(setVDef, ctx(anchor))
        const current = rows.find((d) => d.Title === '1.0.0')!
        expect(c.Resolve(current.Id, ctx(anchor))!.CanExecute()).toBe(false)   // already the pinned version
        const other = rows.find((d) => d.Title === '1.1.0')!
        expect(c.Resolve(other.Id, ctx(anchor))!.CanExecute()).toBe(true)
    })
})
