import { describe, it, expect } from 'vitest'
import { Observable, ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyTreeVM, HierarchyContributorRegistry, HierarchyActionContributorRegistry, type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { SolutionManagerService, Solution, SolutionMemberStatus, type SolutionMember, type ProjectNodeKind, type ProjectFileFormat } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer/services/project-explorer-service.js'
import { SolutionExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-explorer-service.js'
import { ConnectionEditorLauncherKey, type IConnectionEditorLauncher } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connection-actions-contributor.js'
import { type IConnectionView } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connection-view.js'

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

// Records OpenMemberFile + IContentMutations calls; stands in for the surviving
// ProjectExplorerService (which implements IContentMutations).
class FakeExplorer
{
    public readonly opened: Array<[SolutionMember, string, ProjectNodeKind]> = []
    public readonly renamed: Array<[SolutionMember, string, string]> = []
    public readonly deleted: Array<[SolutionMember, string]> = []
    public readonly closed: SolutionMember[] = []
    public async OpenMemberFile(m: SolutionMember, path: string, kind: ProjectNodeKind): Promise<void> { this.opened.push([m, path, kind]) }
    public async RenameMemberFile(m: SolutionMember, p: string, n: string): Promise<void> { this.renamed.push([m, p, n]) }
    public async DeleteMemberFiles(m: SolutionMember, ps: readonly string[]): Promise<void> { for (const p of ps) this.deleted.push([m, p]) }
    public async NewFileForMember(): Promise<void> {}
    public async NewFolderForMember(): Promise<void> {}
    public async ImportFilesForMember(): Promise<void> {}
    public async ImportFolderForMember(): Promise<void> {}
    public async MoveMemberNodes(): Promise<void> {}
    public async PublishMember(): Promise<void> {}
    public async BumpMemberVersion(): Promise<void> {}
    public async SetMemberVersion(): Promise<void> {}
    public async ManageMemberReferences(): Promise<void> {}
    public RefreshMemberBases(): void {}
    public async UpdateMemberAgentMetadata(): Promise<void> {}
    public async CloseMember(m: SolutionMember): Promise<void> { this.closed.push(m) }
    public FormatsFor(): readonly ProjectFileFormat[] { return [] }
    public IsVersionedMember(): boolean { return false }
    public CanRefreshBasesMember(): boolean { return false }
    public SupportsScaffoldMember(): boolean { return false }
    // P5b: the Solution Explorer resolves the connection view through the explorer. A minimal
    // stand-in — an empty connection list, non-consumer members (no per-project active rows).
    public get Connections(): IConnectionView { return FakeExplorer.connections }
    private static readonly connections: IConnectionView = {
        ConnectionsView: async () => [],
        EnvVars: async () => [],
        AddConnection: async () => {},
        UpdateConnection: async () => {},
        SetToken: async () => {},
        UseEnvToken: async () => {},
        SetDefault: async () => {},
        SetSolutionDefault: async () => {},
        RemoveConnection: async () => {},
        TestConnection: async () => ({ ok: true }),
        IsConsumer: () => false,
        ActiveConnectionFor: async () => undefined,
        SetActiveConnectionFor: async () => {},
        OnConnectionsViewChanged: () => ({ dispose: () => {} }),
    }
}

// Records editor-launch requests; the Connections actions contributor needs a launcher.
function fakeLauncher(): IConnectionEditorLauncher
{
    return { OpenNew: () => {}, OpenEdit: () => {} }
}

function make(): { svc: SolutionExplorerService; manager: FakeManager; explorer: FakeExplorer }
{
    const provider = new ServiceProvider()
    const manager = new FakeManager()
    const registry = new HierarchyContributorRegistry(provider)
    const actionRegistry = new HierarchyActionContributorRegistry(provider)
    const explorer = new FakeExplorer()
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)
    provider.registerInstance(HierarchyContributorRegistry.Key, registry)
    provider.registerInstance(HierarchyActionContributorRegistry.Key, actionRegistry)
    provider.registerInstance(ProjectExplorerService.Key, explorer as unknown as ProjectExplorerService)
    provider.registerInstance(ConnectionEditorLauncherKey, fakeLauncher())
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
        // The global Connections branch leads the two member rows.
        expect(svc.Tree!.Roots.Count).toBe(3)
        expect(svc.Tree!.Roots.Get(0)!.Caption).toBe('Connections')
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
        expect(svc.Tree!.Roots.Count).toBe(3)      // Connections + two members
    })

    it('activating a member row (not a file) does not call OpenMemberFile', () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = svc.Tree!.Roots.Get(1)!   // Roots.Get(0) is the Connections branch
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

    it('ActionsFor concats the registered contributors for the node key', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = svc.Tree!.Roots.Get(1)!   // Roots.Get(0) is the Connections branch
        expect(svc.ActionsFor(memberRow).some((a) => a.Label === 'Close Project')).toBe(true)
    })

    it('committing a rename on a file row routes to mutations with the row member', async () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = svc.Tree!.Roots.Get(1)!   // Roots.Get(0) is the Connections branch
        const member = manager.ActiveSolution!.Members.Get(0)
        const fileVm = { Data: { Path: 'a.todl', Kind: 'todl' }, Parent: memberRow, Id: {} } as unknown as HierarchyItemVM
        svc.CommitRename(fileVm, 'b.todl')
        await Promise.resolve()
        expect(explorer.renamed.at(-1)).toEqual([member, 'a.todl', 'b.todl'])
    })
})
