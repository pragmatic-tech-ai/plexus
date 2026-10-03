import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, type HierarchyItem, type HierarchyItemInit, type IRealizeContext, type ItemId } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ConnectionsProvider } from '../connections-provider.js'
import { ConnectionNodeKey } from '../connection-node-key.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from '../connection-view.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

// A fake HierarchyItem: identity + the mutable presentation fields the provider writes, plus
// the ExtObject the init carries. applyLeaf mutates these in place on a ChildUpdated.
class FakeItem
{
    public Caption: string
    public IconKey: string
    public Severity: NodeSeverity | undefined
    public Error: string | undefined
    public ExtObject: unknown
    public readonly CanonicalSegment: string | undefined

    constructor(public readonly Id: ItemId, public readonly Key: string, init?: HierarchyItemInit)
    {
        this.Caption = init?.Caption ?? ''
        this.IconKey = init?.IconKey ?? ''
        this.Severity = init?.Severity
        this.Error = init?.Error
        this.ExtObject = init?.ExtObject
        this.CanonicalSegment = init?.CanonicalSegment
    }
}

// A fake IRealizeContext that mints FakeItems and records the realized child set in order.
class FakeContext implements IRealizeContext
{
    public readonly Children: FakeItem[] = []
    private next = 1

    public NewItem(key: string, init?: HierarchyItemInit): HierarchyItem
    {
        return new FakeItem(this.next++ as ItemId, key, init) as unknown as HierarchyItem
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

function fakeView(list: ConnectionLeafView[]): IConnectionView & { fire: () => void; set: (l: ConnectionLeafView[]) => void }
{
    let handler: (() => void) | undefined
    let current = list
    return {
        fire: () => handler?.(),
        set: (l) => { current = l },
        ConnectionsView: async () => current,
        EnvVars: async () => [],
        AddConnection: async () => {},
        UpdateConnection: async () => {},
        SetToken: async () => {},
        UseEnvToken: async () => {},
        SetDefault: async () => {},
        SetSolutionDefault: async () => {},
        RemoveConnection: async () => {},
        TestConnection: async () => ({ ok: true }),
        IsConsumer: () => true,
        ActiveConnectionFor: async () => undefined,
        SetActiveConnectionFor: async () => {},
        OnConnectionsViewChanged: (h) => { handler = h as () => void; return { dispose() { handler = undefined } } as Disposable },
    }
}

const leaf = (Id: string, Health: ConnectionHealth): ConnectionLeafView => ({
    Id, DisplayName: Id, RegistryType: 'npm',
    IsDefault: Health === ConnectionHealth.Default,
    IsSolutionDefault: false,
    HasToken: Health !== ConnectionHealth.NoCredentials,
    Health,
    Message: Health === ConnectionHealth.Unreachable ? '401' : undefined,
})

// The Connections root the model hands the provider (Key = NodeKey.Connections); Realize
// pushes the leaves into it via the context.
function rootItem(): HierarchyItem
{
    return new FakeItem(0 as ItemId, NodeKey.Connections) as unknown as HierarchyItem
}

async function realizeRoot(p: ConnectionsProvider): Promise<FakeContext>
{
    const ctx = new FakeContext()
    p.Realize(rootItem(), ctx)
    await tick()
    return ctx
}

describe('ConnectionsProvider', () =>
{
    it('emits a flat leaf per connection, decorated by health', async () =>
    {
        const p = new ConnectionsProvider(fakeView([leaf('a', ConnectionHealth.Default), leaf('b', ConnectionHealth.NoCredentials)]))
        const ctx = await realizeRoot(p)
        expect(ctx.Children.map((c) => c.Caption).sort()).toEqual(['a (npm)', 'b (npm)'])
        expect(ctx.Children.every((c) => c.Key === ConnectionNodeKey.Leaf)).toBe(true)
        expect(ctx.Children.find((c) => c.Caption === 'b (npm)')!.Severity).toBe(NodeSeverity.Warning)
        expect(ctx.Children.find((c) => c.Caption === 'a (npm)')!.Severity).toBe(NodeSeverity.Ok)
    })

    it('encodes health in the leaf icon suffix (default vs nocreds)', async () =>
    {
        const p = new ConnectionsProvider(fakeView([leaf('a', ConnectionHealth.Default), leaf('b', ConnectionHealth.NoCredentials)]))
        const ctx = await realizeRoot(p)
        expect(ctx.Children.find((c) => c.Caption === 'a (npm)')!.IconKey).toBe(ConnectionNodeKey.Leaf + '-default')
        expect(ctx.Children.find((c) => c.Caption === 'b (npm)')!.IconKey).toBe(ConnectionNodeKey.Leaf + '-nocreds')
    })

    it('on change: an edit to the same id mutates the SAME leaf in place; a removal drops it', async () =>
    {
        const view = fakeView([leaf('a', ConnectionHealth.NoCredentials), leaf('b', ConnectionHealth.Ready)])
        const p = new ConnectionsProvider(view)
        const ctx = await realizeRoot(p)
        const leafA = ctx.Children.find((c) => c.Caption === 'a (npm)')!
        expect(ctx.Children.length).toBe(2)

        view.set([leaf('a', ConnectionHealth.Ready)])   // a improved (health change), b removed
        view.fire()
        await tick()

        expect(ctx.Children.length).toBe(1)
        expect(ctx.Children[0]).toBe(leafA)                               // same instance, updated in place
        expect(leafA.IconKey).toBe(ConnectionNodeKey.Leaf + '-ready')     // nocreds -> ready
        expect(ctx.Children.some((c) => c.Caption === 'b (npm)')).toBe(false)   // b gone
    })

    it('canonical names resolve the root and each leaf; a removed leaf stops resolving', async () =>
    {
        const view = fakeView([leaf('a', ConnectionHealth.Ready), leaf('b', ConnectionHealth.Ready)])
        const p = new ConnectionsProvider(view)
        const ctx = await realizeRoot(p)
        const leafA = ctx.Children.find((c) => c.Caption === 'a (npm)')! as unknown as HierarchyItem
        expect(p.GetCanonicalName(leafA)).toBe('connections/a')
        expect(p.ParseCanonicalName('connections/a')).toBe(leafA)

        view.set([leaf('b', ConnectionHealth.Ready)])   // a removed
        view.fire()
        await tick()
        expect(p.ParseCanonicalName('connections/a')).toBeUndefined()
    })
})
