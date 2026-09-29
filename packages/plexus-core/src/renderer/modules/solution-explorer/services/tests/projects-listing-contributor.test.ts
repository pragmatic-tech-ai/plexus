import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, HierarchyContributorRegistry, type HierarchyNode } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Solution, SolutionMemberStatus } from '@pragmatic-tech-ai/todl'
import { ProjectsListingContributor } from '../projects-listing-contributor.js'

function rootNode(): HierarchyNode
{
    return { Key: NodeKey.Solution, Caption: 'S', IconKey: 'solution', ExtObject: undefined, Severity: NodeSeverity.Ok }
}

function registry(): HierarchyContributorRegistry
{
    return new HierarchyContributorRegistry(new ServiceProvider())
}

describe('ProjectsListingContributor', () =>
{
    it('contributes one project node per member, in order, keyed NodeKey.Project', () =>
    {
        const sol = new Solution('S')
        const a = sol.AddMember('./a', 'architecture')
        const b = sol.AddMember('./b', 'architecture')
        a.Status = SolutionMemberStatus.Resolved
        b.Status = SolutionMemberStatus.Resolved
        const c = new ProjectsListingContributor(sol, registry())
        const nodes = c.Contribute(rootNode()).Nodes
        expect(nodes.map((n) => n.ExtObject)).toEqual([a, b])
        expect(nodes.every((n) => n.Key === NodeKey.Project)).toBe(true)
        c.dispose()
    })

    it('maps LoadFailed -> Error severity + Error text, UnknownType -> Warning, Resolved -> Ok+expandable', () =>
    {
        const sol = new Solution('S')
        const bad = sol.AddMember('./bad', 'nope')
        bad.Status = SolutionMemberStatus.LoadFailed
        bad.Error = 'boom'
        const unknown = sol.AddMember('./u', 'nope')
        unknown.Status = SolutionMemberStatus.UnknownType
        const ok = sol.AddMember('./ok', 'architecture')
        ok.Status = SolutionMemberStatus.Resolved
        const c = new ProjectsListingContributor(sol, registry())
        const nodes = c.Contribute(rootNode()).Nodes
        expect(nodes[0]!.Severity).toBe(NodeSeverity.Error)
        expect(nodes[0]!.Error).toBe('boom')
        expect(nodes[0]!.IsExpandable).toBe(false)
        expect(nodes[1]!.Severity).toBe(NodeSeverity.Warning)
        expect(nodes[2]!.Severity).toBe(NodeSeverity.Ok)
        expect(nodes[2]!.IsExpandable).toBe(true)
        c.dispose()
    })

    it('notifies the registry when a member is added', () =>
    {
        const sol = new Solution('S')
        const reg = registry()
        let notified = 0
        reg.PropertyChanged('Contributors').subscribe(() => notified++)
        const c = new ProjectsListingContributor(sol, reg)
        const before = notified
        sol.AddMember('./a', 'architecture')
        expect(notified).toBeGreaterThan(before)
        c.dispose()
    })

    it('notifies when a member Status flips, and dispose stops it', () =>
    {
        const sol = new Solution('S')
        const m = sol.AddMember('./a', 'architecture')
        const reg = registry()
        const c = new ProjectsListingContributor(sol, reg)
        let notified = 0
        reg.PropertyChanged('Contributors').subscribe(() => notified++)
        m.Status = SolutionMemberStatus.Resolved
        expect(notified).toBeGreaterThan(0)
        const after = notified
        c.dispose()
        m.Status = SolutionMemberStatus.LoadFailed
        expect(notified).toBe(after)   // no leak after dispose
    })
})
