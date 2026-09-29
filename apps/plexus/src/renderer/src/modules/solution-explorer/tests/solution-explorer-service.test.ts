import { describe, it, expect } from 'vitest'
import { Observable, ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyTreeVM, HierarchyContributorRegistry } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { SolutionManagerService, Solution, SolutionMemberStatus, type SolutionMember, type ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer/services/project-explorer-service.js'
import { SolutionExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-explorer-service.js'

// A minimal SolutionManagerService stand-in: an observable ActiveSolution the capability
// subscribes to, plus a setter to drive open/close/swap.
class FakeManager extends Observable
{
    private _active: Solution | undefined
    public get ActiveSolution(): Solution | undefined { return this._active }
    public SetActive(s: Solution | undefined): void
    {
        const old = this._active
        this._active = s
        this.RaisePropertyChanged('ActiveSolution', old, s)
    }
}

// Records OpenMemberFile calls; stands in for the surviving ProjectExplorerService.
class FakeExplorer
{
    public readonly opened: Array<[SolutionMember, string, ProjectNodeKind]> = []
    public async OpenMemberFile(m: SolutionMember, path: string, kind: ProjectNodeKind): Promise<void>
    {
        this.opened.push([m, path, kind])
    }
}

function make(): { svc: SolutionExplorerService; manager: FakeManager; explorer: FakeExplorer }
{
    const provider = new ServiceProvider()
    const manager = new FakeManager()
    const registry = new HierarchyContributorRegistry(provider)
    const explorer = new FakeExplorer()
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)
    provider.registerInstance(HierarchyContributorRegistry.Key, registry)
    provider.registerInstance(ProjectExplorerService.Key, explorer as unknown as ProjectExplorerService)
    return { svc: new SolutionExplorerService(provider), manager, explorer }
}

function solutionWith(...names: string[]): Solution
{
    const sol = new Solution('S')
    for (const n of names)
    {
        const m = sol.AddMember(`./${n}`, 'architecture')
        m.Status = SolutionMemberStatus.Resolved
        m.Storage = new FakeStorage(`/${n}`)
    }
    return sol
}

describe('SolutionExplorerService', () =>
{
    it('publishes a Tree with a row per member when a solution opens', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        expect(svc.Tree).toBeUndefined()
        manager.SetActive(solutionWith('a', 'b'))
        expect(svc.Tree).toBeInstanceOf(HierarchyTreeVM)
        expect(svc.Tree!.Roots.Count).toBe(2)
    })

    it('closing the solution clears Tree', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        expect(svc.Tree).toBeDefined()
        manager.SetActive(undefined)
        expect(svc.Tree).toBeUndefined()
    })

    it('a second open disposes the prior tree', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const first = svc.Tree!
        manager.SetActive(solutionWith('x', 'y'))
        expect(svc.Tree).not.toBe(first)
        expect(first.Roots.Count).toBe(0)          // prior tree torn down
        expect(svc.Tree!.Roots.Count).toBe(2)
    })

    it('activating a member row (not a file) does not call OpenMemberFile', () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = svc.Tree!.Roots.Get(0)!
        memberRow.OnActivate()
        expect(explorer.opened).toHaveLength(0)   // a member row's Data is a SolutionMember, not a file
    })

    it('dispose stops following ActiveSolution and clears the Tree', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        svc.dispose()
        expect(svc.Tree).toBeUndefined()
        manager.SetActive(solutionWith('later'))   // ignored after dispose
        expect(svc.Tree).toBeUndefined()
    })
})
