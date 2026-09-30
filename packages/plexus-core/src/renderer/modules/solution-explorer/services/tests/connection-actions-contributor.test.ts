import { describe, it, expect } from 'vitest'
import { NodeKey, type HierarchyActionContext, type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { SolutionMember } from '@pragmatic-tech-ai/todl'
import { ConnectionActionsContributor, type IConnectionEditorLauncher } from '../connection-actions-contributor.js'
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

function fakeLauncher(): IConnectionEditorLauncher & { opened: (string | undefined)[] }
{
    const opened: (string | undefined)[] = []
    return { opened, OpenNew: () => { opened.push(undefined) }, OpenEdit: (id: string) => { opened.push(id) } }
}

function vm(key: string, data: unknown, parent?: HierarchyItemVM): HierarchyItemVM
{
    return { Key: key, Data: data, Parent: parent } as unknown as HierarchyItemVM
}
// Give a row a project parent whose Data is the member, so MemberOf resolves it.
const underMember = (v: HierarchyItemVM): HierarchyItemVM => vm(v.Key, (v as unknown as { Data: unknown }).Data, vm(NodeKey.Project, member))
const ctx = (anchor: HierarchyItemVM, selection: HierarchyItemVM[] = [anchor]): HierarchyActionContext => ({ Anchor: anchor, Selection: selection })
const leaf = (id: string, isDefault: boolean, isSolutionDefault = false) => underMember(vm(ConnectionNodeKey.Leaf, { id, isDefault, isSolutionDefault }))

describe('ConnectionActionsContributor', () =>
{
    it('the Connections node offers New Connection…, which opens the editor', () =>
    {
        const launcher = fakeLauncher()
        const c = new ConnectionActionsContributor(fakeView(), launcher)
        const action = c.ActionsFor(ctx(vm(NodeKey.Connections, {}))).find((a) => a.Label === 'New Connection…')!
        expect(action).toBeDefined()
        action.Invoke.Execute()
        expect(launcher.opened).toEqual([undefined])
    })

    it('a leaf offers Edit…, Test, Make Default, Make Solution Default, Remove', () =>
    {
        const c = new ConnectionActionsContributor(fakeView(), fakeLauncher())
        const labels = c.ActionsFor(ctx(leaf('b', false))).map((a) => a.Label)
        expect(labels).toEqual(expect.arrayContaining(['Edit…', 'Test', 'Make Default', 'Make Solution Default', 'Remove']))
    })

    it('Make Solution Default sets the solution default and is non-executable on the current one', () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        c.ActionsFor(ctx(leaf('b', false))).find((a) => a.Label === 'Make Solution Default')!.Invoke.Execute()
        expect(v.solutionDefaulted).toEqual(['b'])
        const onCurrent = c.ActionsFor(ctx(leaf('b', false, true))).find((a) => a.Label === 'Make Solution Default')!
        expect(onCurrent.Invoke.CanExecute()).toBe(false)
    })

    it('Make Default is non-executable on the connection that is already default', () =>
    {
        const c = new ConnectionActionsContributor(fakeView(), fakeLauncher())
        const makeDefault = c.ActionsFor(ctx(leaf('a', true))).find((a) => a.Label === 'Make Default')!
        expect(makeDefault.Invoke.CanExecute()).toBe(false)
    })

    it('Test invokes TestConnection for the leaf id', () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        c.ActionsFor(ctx(leaf('b', false))).find((a) => a.Label === 'Test')!.Invoke.Execute()
        expect(v.tested).toEqual(['b'])
    })

    it('Remove on a multi-selected set removes every selected connection by id', async () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        const a = leaf('a', true)
        const b = leaf('b', false)
        c.ActionsFor(ctx(a, [a, b])).find((x) => x.Label === 'Remove')!.Invoke.Execute()
        await tick()
        expect(v.removed.sort()).toEqual(['a', 'b'])
    })

    it('the active-connection row offers a submenu that sets the chosen connection', async () =>
    {
        const v = fakeView()
        const c = new ConnectionActionsContributor(v, fakeLauncher())
        const anchor = underMember(vm(ConnectionNodeKey.Active, { member }))
        const submenu = c.ActionsFor(ctx(anchor)).find((a) => a.Label === 'Active connection')!
        expect(submenu).toBeDefined()
        await tick()
        const pickB = [...Array(submenu.Children.Count).keys()].map((i) => submenu.Children.Get(i)!).find((x) => x.Label === 'B')!
        pickB.Invoke.Execute()
        await tick()
        expect(v.active).toContainEqual([member, 'b'])
    })
})
