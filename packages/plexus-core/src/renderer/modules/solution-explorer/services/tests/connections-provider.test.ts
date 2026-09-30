import { describe, it, expect } from 'vitest'
import { HierarchyItemId, ChildAdded, NodeSeverity, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ConnectionsProvider } from '../connections-provider.js'
import { ConnectionNodeKey } from '../connection-node-key.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from '../connection-view.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

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
    HasToken: Health !== ConnectionHealth.NoCredentials,
    Health,
    Message: Health === ConnectionHealth.Unreachable ? '401' : undefined,
})

async function realizeRoot(p: ConnectionsProvider): Promise<HierarchyChange[]>
{
    const changes: HierarchyChange[] = []
    // The model assigns the Connections node id; the provider emits leaves under it.
    p.ObserveChildren(HierarchyItemId.Mint(), (c) => changes.push(c))
    await tick()
    return changes
}

describe('ConnectionsProvider', () =>
{
    it('emits a flat leaf per connection, decorated by health', async () =>
    {
        const p = new ConnectionsProvider(fakeView([leaf('a', ConnectionHealth.Default), leaf('b', ConnectionHealth.NoCredentials)]))
        const added = (await realizeRoot(p)).filter((c) => c instanceof ChildAdded) as ChildAdded[]
        expect(added.map((c) => c.Node.Caption).sort()).toEqual(['a (npm)', 'b (npm)'])
        expect(added.every((c) => c.Node.Key === ConnectionNodeKey.Leaf)).toBe(true)
        const b = added.find((c) => c.Node.Caption === 'b (npm)')!
        expect(b.Node.Severity).toBe(NodeSeverity.Warning)
        expect(added.find((c) => c.Node.Caption === 'a (npm)')!.Node.Severity).toBe(NodeSeverity.Ok)
    })

    it('encodes health in the leaf icon suffix (default vs nocreds)', async () =>
    {
        const p = new ConnectionsProvider(fakeView([leaf('a', ConnectionHealth.Default), leaf('b', ConnectionHealth.NoCredentials)]))
        const added = (await realizeRoot(p)).filter((c) => c instanceof ChildAdded) as ChildAdded[]
        expect(added.find((c) => c.Node.Caption === 'a (npm)')!.Node.IconKey).toBe(ConnectionNodeKey.Leaf + '-default')
        expect(added.find((c) => c.Node.Caption === 'b (npm)')!.Node.IconKey).toBe(ConnectionNodeKey.Leaf + '-nocreds')
    })

    it('on change: an edit to the same id is a ChildUpdated; a removal is a ChildRemoved', async () =>
    {
        const view = fakeView([leaf('a', ConnectionHealth.NoCredentials), leaf('b', ConnectionHealth.Ready)])
        const p = new ConnectionsProvider(view)
        const changes = await realizeRoot(p)
        changes.length = 0
        view.set([leaf('a', ConnectionHealth.Ready)])   // a improved (health change), b removed
        view.fire()
        await tick()
        const kinds = changes.map((c) => c.constructor.name)
        expect(kinds).toContain('ChildUpdated')   // a: nocreds -> ready, same id
        expect(kinds).toContain('ChildRemoved')   // b gone
    })
})
