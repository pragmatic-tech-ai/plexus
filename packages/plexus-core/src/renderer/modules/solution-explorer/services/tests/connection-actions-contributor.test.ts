import { describe, it, expect } from 'vitest'
import { NodeKey, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import type { CommandDefinition } from '@pragmatic-tech-ai/mural/framework'
import { SolutionMember } from '@pragmatic-tech-ai/todl'
import { ConnectionActionsContributor, ConnectionActiveSubmenuContributor, type IConnectionEditorLauncher } from '../connection-actions-contributor.js'
import { ConnectionNodeKey } from '../connection-node-key.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from '../connection-view.js'

const tick = () => new Promise((r) => setTimeout(r, 10))
const member = new SolutionMember({ path: 'p', type: 'architecture' })

function fakeView(over: Partial<IConnectionView> = {}): IConnectionView & { removed: string[]; defaulted: string[]; solutionDefaulted: string[]; tested: string[]; active: [SolutionMember, string | undefined][] }
{
    const removed: string[] = []
    const defaulted: string[] = []
    const solutionDefaulted: string[] = []
    const tested: string[] = []
    const active: [SolutionMember, string | undefined][] = []
    const list: ConnectionLeafView[] = [
        { Id: 'a', DisplayName: 'A', RegistryType: 'npm', IsDefault: true, IsSolutionDefault: false, HasToken: true, Health: ConnectionHealth.Default },
        { Id: 'b', DisplayName: 'B', RegistryType: 'npm', IsDefault: false, IsSolutionDefault: false, HasToken: true, Health: ConnectionHealth.Ready },
    ]
    const base: IConnectionView = {
        ConnectionsView: async () => list,
        EnvVars: async () => [],
        AddConnection: async () => {},
        UpdateConnection: async () => {},
        SetToken: async () => {},
        UseEnvToken: async () => {},
        SetDefault: async (id) => { defaulted.push(id) },
        SetSolutionDefault: async (id) => { solutionDefaulted.push(id) },
        RemoveConnection: async (id) => { removed.push(id) },
        TestConnection: async (id) => { tested.push(id); return { ok: true } },
        IsConsumer: () => true,
        ActiveConnectionFor: async () => list[0],
        SetActiveConnectionFor: async (m, id) => { active.push([m, id]) },
        OnConnectionsViewChanged: () => ({ dispose() {} }),
    }
    return Object.assign(base, { removed, defaulted, solutionDefaulted, tested, active }, over) as never
}

function fakeLauncher(): IConnectionEditorLauncher & { opened: (string | undefined)[]; inspected: string[] }
{
    const opened: (string | undefined)[] = []
    const inspected: string[] = []
    return { opened, inspected, OpenNew: () => { opened.push(undefined) }, OpenEdit: (id: string) => { opened.push(id) }, OpenTest: (id: string) => { inspected.push(id) } }
}

// A fake hierarchy row: Key + ExtObject (+ Parent so MemberOf can climb to the member).
class FakeItem
{
    public Parent: FakeItem | undefined

    constructor(public readonly Key: string, public readonly ExtObject: unknown, parent?: FakeItem)
    {
        this.Parent = parent
    }
}

const projectRow = new FakeItem(NodeKey.Project, member)
const leafRow = (id: string, isDefault: boolean, isSolutionDefault = false): HierarchyItem =>
    new FakeItem(ConnectionNodeKey.Leaf, { id, isDefault, isSolutionDefault }, projectRow) as unknown as HierarchyItem
const connectionsRow = (): HierarchyItem => new FakeItem(NodeKey.Connections, {}) as unknown as HierarchyItem
const activeRow = (): HierarchyItem => new FakeItem(ConnectionNodeKey.Active, { member }, projectRow) as unknown as HierarchyItem
const ctx = (anchor: HierarchyItem, selection: HierarchyItem[] = [anchor]): HierarchyActionContext => new HierarchyActionContext(anchor, selection)

function leafTitles(c: ConnectionActionsContributor): string[]
{
    return c.Actions.filter((a) => a.Context === HierarchyContext.For(ConnectionNodeKey.Leaf)).map((a) => a.Title)
}

function defById(c: ConnectionActionsContributor, id: string): CommandDefinition
{
    return c.Actions.find((a) => a.Id === id)!
}

describe('ConnectionActionsContributor', () =>
{
    it('the Connections node offers New Connection…, which opens the editor', () =>
    {
        const launcher = fakeLauncher()
        const c = new ConnectionActionsContributor(fakeView(), launcher)
        expect(c.Actions.find((a) => a.Id === ConnectionActionsContributor.NewId)!.Title).toBe('New Connection…')
        c.Resolve(ConnectionActionsContributor.NewId, ctx(connectionsRow()))!.Execute()
        expect(launcher.opened).toEqual([undefined])
    })

    it('a leaf offers Edit…, Test, Make Default, Make Solution Default, Remove', () =>
    {
        const c = new ConnectionActionsContributor(fakeView(), fakeLauncher())
        expect(leafTitles(c)).toEqual(expect.arrayContaining(['Edit…', 'Test', 'Make Default', 'Make Solution Default', 'Remove']))
    })

    it('Make Solution Default sets the solution default and is non-executable on the current one', () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        c.Resolve(ConnectionActionsContributor.MakeSolutionDefaultId, ctx(leafRow('b', false)))!.Execute()
        expect(v.solutionDefaulted).toEqual(['b'])
        const onCurrent = c.Resolve(ConnectionActionsContributor.MakeSolutionDefaultId, ctx(leafRow('b', false, true)))!
        expect(onCurrent.CanExecute()).toBe(false)
    })

    it('Make Default is non-executable on the connection that is already default', () =>
    {
        const c = new ConnectionActionsContributor(fakeView(), fakeLauncher())
        expect(c.Resolve(ConnectionActionsContributor.MakeDefaultId, ctx(leafRow('a', true)))!.CanExecute()).toBe(false)
    })

    it('Test opens the inspection dialog for the leaf id instead of a bare TestConnection', () =>
    {
        const v = fakeView()
        const launcher = fakeLauncher()
        const c = new ConnectionActionsContributor(v, launcher)
        c.Resolve(ConnectionActionsContributor.TestId, ctx(leafRow('b', false)))!.Execute()
        expect(launcher.inspected).toEqual(['b'])
        expect(v.tested).toEqual([])
    })

    it('Edit… opens the editor for the leaf id', () =>
    {
        const launcher = fakeLauncher()
        const c = new ConnectionActionsContributor(fakeView(), launcher)
        c.Resolve(ConnectionActionsContributor.EditId, ctx(leafRow('b', false)))!.Execute()
        expect(launcher.opened).toEqual(['b'])
    })

    it('Remove on a multi-selected set removes every selected connection by id', async () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        const a = leafRow('a', true)
        const b = leafRow('b', false)
        c.Resolve(ConnectionActionsContributor.RemoveId, ctx(a, [a, b]))!.Execute()
        await tick()
        expect(v.removed.sort()).toEqual(['a', 'b'])
    })

    it('the active-connection row offers a lazy submenu that sets the chosen connection', async () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        const submenu = new ConnectionActiveSubmenuContributor(v)
        const activeDef = defById(c, ConnectionActionsContributor.ActiveId)
        expect(activeDef.Title).toBe('Active connection')
        expect(activeDef.ChildrenContributor).toBe(ConnectionActiveSubmenuContributor.Key)

        const anchor = activeRow()
        const loading = submenu.Contribute(activeDef, ctx(anchor))
        expect(loading.map((d) => d.Title)).toEqual(['Loading…'])   // fetched fire-and-forget on first open
        await tick()
        const rows = submenu.Contribute(activeDef, ctx(anchor))
        const pickB = rows.find((d) => d.Title === 'B')!
        c.Resolve(pickB.Id, ctx(anchor))!.Execute()
        await tick()
        expect(v.active).toContainEqual([member, 'b'])
    })

    it('the currently-active pick in the submenu is marked non-executable', async () =>
    {
        const v = fakeView()   // ActiveConnectionFor returns 'a'
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        const submenu = new ConnectionActiveSubmenuContributor(v)
        const activeDef = defById(c, ConnectionActionsContributor.ActiveId)
        const anchor = activeRow()
        submenu.Contribute(activeDef, ctx(anchor))
        await tick()
        const rows = submenu.Contribute(activeDef, ctx(anchor))
        const currentA = rows.find((d) => d.Title === 'A')!
        expect(currentA.Id.startsWith(ConnectionActionsContributor.ActiveCurrentChildPrefix)).toBe(true)
        expect(c.Resolve(currentA.Id, ctx(anchor))!.CanExecute()).toBe(false)
    })
})
