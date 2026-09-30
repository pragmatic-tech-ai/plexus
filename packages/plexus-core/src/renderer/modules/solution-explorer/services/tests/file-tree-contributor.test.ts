import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, ProviderContribution, NodeContribution, type HierarchyNode } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Solution, SolutionMemberStatus } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from '../file-tree-contributor.js'
import type { IConnectionView } from '../connection-view.js'

// A consumer connection view whose OnConnectionsViewChanged subscriptions are counted, so a
// test can prove a leading branch (and its subscription) is built once, not per Contribute.
function countingConnectionView(): IConnectionView & { subs: number }
{
    const view = {
        subs: 0,
        ConnectionsView: async () => [],
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
        OnConnectionsViewChanged: () => { view.subs += 1; return { dispose: () => { view.subs -= 1 } } },
    }
    return view
}

function memberNode(ext: unknown): HierarchyNode
{
    return { Key: NodeKey.Project, Caption: 'p', IconKey: NodeKey.Project, ExtObject: ext, Severity: NodeSeverity.Ok }
}

function resolvedMember(sol: Solution, storage: FakeStorage)
{
    const m = sol.AddMember('./p', 'architecture')
    m.Status = SolutionMemberStatus.Resolved
    m.Storage = storage
    return m
}

describe('FileTreeContributor', () =>
{
    it('a resolved member yields a ProviderContribution', () =>
    {
        const sol = new Solution('S')
        const m = resolvedMember(sol, new FakeStorage())
        const c = new FileTreeContributor()
        expect(c.Contribute(memberNode(m))).toBeInstanceOf(ProviderContribution)
        c.dispose()
    })

    it('returns the SAME provider instance for repeated Contribute of one member', () =>
    {
        const sol = new Solution('S')
        const m = resolvedMember(sol, new FakeStorage())
        const c = new FileTreeContributor()
        const first = c.Contribute(memberNode(m)) as ProviderContribution
        const second = c.Contribute(memberNode(m)) as ProviderContribution
        expect(second.Provider).toBe(first.Provider)
        c.dispose()
    })

    it('builds the per-project leading branch ONCE across repeated Contribute (no subscription leak on cache hit)', () =>
    {
        const sol = new Solution('S')
        const m = resolvedMember(sol, new FakeStorage())
        const view = countingConnectionView()
        const c = new FileTreeContributor()
        c.SetConnectionView(view)
        c.Contribute(memberNode(m))          // cache miss → builds one ActiveConnectionLeadingBranch (subscribes once)
        c.Contribute(memberNode(m))          // cache hit → must NOT build/subscribe again
        expect(view.subs).toBe(1)
        c.dispose()
        expect(view.subs).toBe(0)            // dispose releases it
    })

    it('an unresolved member yields an empty NodeContribution (leaf)', () =>
    {
        const sol = new Solution('S')
        const m = sol.AddMember('./p', 'nope')
        m.Status = SolutionMemberStatus.UnknownType
        const c = new FileTreeContributor()
        const contribution = c.Contribute(memberNode(m))
        expect(contribution).toBeInstanceOf(NodeContribution)
        expect((contribution as NodeContribution).Nodes.length).toBe(0)
        c.dispose()
    })

    it('Release disposes a member store; dispose does not throw for a never-expanded store', () =>
    {
        const sol = new Solution('S')
        const m = resolvedMember(sol, new FakeStorage())
        const c = new FileTreeContributor()
        c.Contribute(memberNode(m))          // mounts a store (never subscribed)
        expect(() => c.Release(m)).not.toThrow()
        // After Release, a fresh Contribute makes a new provider (the old was disposed).
        const again = c.Contribute(memberNode(m)) as ProviderContribution
        expect(again).toBeInstanceOf(ProviderContribution)
        expect(() => c.dispose()).not.toThrow()
    })
})
