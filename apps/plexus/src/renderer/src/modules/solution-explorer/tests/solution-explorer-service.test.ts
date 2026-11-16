import { describe, it, expect } from 'vitest'
import { Observable, ServiceProvider, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { Hierarchy, HierarchyContributorRegistry, HierarchyActionContext, type HierarchyItem } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { SolutionManagerService, Solution, SolutionMemberStatus, type SolutionMember, type ProjectNodeKind, type ProjectFileFormat } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionWorkspaceService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-workspace-service.js'
import { ProjectCommandsService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/project-commands-service.js'
import { SolutionExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-explorer-service.js'
import { ConnectionEditorLauncherKey, type IConnectionEditorLauncher } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connection-actions-contributor.js'
import { type IConnectionView } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connection-view.js'
import { SkillRunSubmenuContributor } from '../../skills/services/skill-run-submenu-contributor.js'

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

// Records OpenMemberFile + IContentMutations calls; stands in for SolutionWorkspaceService
// (the IContentMutations implementer that also supplies the References / Connections views).
class FakeWorkspace
{
    public readonly opened: Array<[SolutionMember, string, ProjectNodeKind, boolean]> = []
    public readonly renamed: Array<[SolutionMember, string, string]> = []
    public readonly deleted: Array<[SolutionMember, string]> = []
    public readonly closed: SolutionMember[] = []
    public async OpenMemberFile(m: SolutionMember, path: string, kind: ProjectNodeKind, preview = false): Promise<void> { this.opened.push([m, path, kind, preview]) }
    public async RenameMemberFile(m: SolutionMember, p: string, n: string): Promise<void> { this.renamed.push([m, p, n]) }
    public async DeleteMemberFiles(m: SolutionMember, ps: readonly string[]): Promise<void> { for (const p of ps) this.deleted.push([m, p]) }
    public async NewFileForMember(): Promise<void> {}
    public async NewFolderForMember(): Promise<void> {}
    public async ImportFilesForMember(): Promise<void> {}
    public async ImportFolderForMember(): Promise<void> {}
    public async MoveMemberNodes(): Promise<void> {}
    public async EnsureMemberGenerated(): Promise<void> {}
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
    // The Solution Explorer resolves the connection view through the workspace service. A minimal
    // stand-in — an empty connection list, non-consumer members (no per-project active rows).
    public get Connections(): IConnectionView { return FakeWorkspace.connections }
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

// Stands in for ProjectCommandsService: the command bar binds to these two commands.
class FakeCommands
{
    public readonly OpenProjectCommand: ICommand = new RelayCommand(() => {})
    public readonly NewProjectCommand: ICommand = new RelayCommand(() => {})
}

// Records editor-launch requests; the Connections actions contributor needs a launcher.
function fakeLauncher(): IConnectionEditorLauncher
{
    return { OpenNew: () => {}, OpenEdit: () => {} }
}

function make(): { svc: SolutionExplorerService; manager: FakeManager; explorer: FakeWorkspace; commands: FakeCommands }
{
    const provider = new ServiceProvider()
    const manager = new FakeManager()
    const registry = new HierarchyContributorRegistry(provider)
    const explorer = new FakeWorkspace()
    const commands = new FakeCommands()
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)
    provider.registerInstance(HierarchyContributorRegistry.Key, registry)
    provider.registerInstance(SolutionWorkspaceService.Key, explorer as unknown as SolutionWorkspaceService)
    provider.registerInstance(ProjectCommandsService.Key, commands as unknown as ProjectCommandsService)
    provider.registerInstance(ConnectionEditorLauncherKey, fakeLauncher())
    return { svc: new SolutionExplorerService(provider), manager, explorer, commands }
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

const actionCtx = (anchor: HierarchyItem): HierarchyActionContext => new HierarchyActionContext(anchor, [anchor])

// After a solution opens, the tree is ONE visible Solution root (expanded by the
// service on rebuild) whose children are the global Connections branch followed by a
// row per member. These reach the nested rows the old flat Roots layout exposed directly.
const solutionRoot = (svc: SolutionExplorerService): HierarchyItem => svc.Hierarchy!.Roots.Get(0)!
// Child 0 under the Solution root is the Connections branch; the member rows follow it.
const projectRow = (svc: SolutionExplorerService, index: number): HierarchyItem => solutionRoot(svc).Children.Get(index + 1)!

describe('SolutionExplorerService', () =>
{
    it('builds a Hierarchy with a row per member when a solution opens', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        expect(svc.Hierarchy).toBeInstanceOf(Hierarchy)
        expect(svc.Hierarchy!.Roots.Count).toBe(0)   // no solution yet
        manager.SetActive(solutionWith('a', 'b'))
        // One visible Solution root; under it the Connections branch leads the two member rows.
        expect(svc.Hierarchy!.Roots.Count).toBe(1)
        const root = solutionRoot(svc)
        expect(root.Children.Count).toBe(3)
        expect(root.Children.Get(0)!.Caption).toBe('Connections')
    })

    it('exposes a Hierarchy BEFORE Start() — the panel can bind it as the default destination (regression: empty tree)', () =>
    {
        // When the Solution Explorer is the shell's first rail destination, its pane resolves at
        // startup and attaches HierarchyContextMenuBehavior (which throws on an undefined Hierarchy)
        // BEFORE the host calls Start(). The hierarchy must therefore exist on first access.
        const { svc } = make()
        expect(svc.Hierarchy).toBeInstanceOf(Hierarchy)   // created lazily, no Start() yet
        const early = svc.Hierarchy!
        svc.Start()
        expect(svc.Hierarchy).toBe(early)                 // Start() reuses the same instance
    })

    it('closing the solution clears the Hierarchy roots', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        expect(svc.Hierarchy!.Roots.Count).toBeGreaterThan(0)
        manager.SetActive(undefined)
        expect(svc.Hierarchy!.Roots.Count).toBe(0)
        expect(svc.HasNoSolution).toBe(true)
    })

    it('reuses ONE stable Hierarchy across opens; a second open rebuilds its roots in place', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const first = svc.Hierarchy!
        manager.SetActive(solutionWith('x', 'y'))
        expect(svc.Hierarchy).toBe(first)                 // stable instance — the template binds it once
        expect(svc.Hierarchy!.Roots.Count).toBe(1)        // still one Solution root, rebuilt in place
        expect(solutionRoot(svc).Children.Count).toBe(3)  // Connections + two members
    })

    it('resolves SolutionWorkspaceService + ProjectCommandsService: the command bar commands pass through', () =>
    {
        const { svc, commands } = make()
        expect(svc.OpenProjectCommand).toBe(commands.OpenProjectCommand)
        expect(svc.NewProjectCommand).toBe(commands.NewProjectCommand)
    })

    it('activating a file row (double-click) opens it as a PERMANENT tab', async () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)
        const member = manager.ActiveSolution!.Members.Get(0)
        const fileVm = { ExtObject: { Path: 'a.todl', Kind: 'todl' }, Parent: memberRow, Id: 0 } as unknown as HierarchyItem
        svc.Activate(fileVm)
        await Promise.resolve()
        await Promise.resolve()
        // Double-click pins a permanent tab → preview flag false.
        expect(explorer.opened.at(-1)).toEqual([member, 'a.todl', 'todl', false])
    })

    it('single-click (selecting one file row) opens it as an EPHEMERAL PREVIEW tab', async () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)
        const member = manager.ActiveSolution!.Members.Get(0)
        const fileVm = { ExtObject: { Path: 'a.todl', Kind: 'todl' }, Parent: memberRow, Id: 0 } as unknown as HierarchyItem
        svc.Hierarchy!.Selection.Add(fileVm)   // the TreeView selects on single click / keyboard move
        await Promise.resolve()
        await Promise.resolve()
        // Navigation opens in the reused preview tab → preview flag true.
        expect(explorer.opened.at(-1)).toEqual([member, 'a.todl', 'todl', true])
    })

    it('selecting a member row (not a file) does not open anything', async () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)
        svc.Hierarchy!.Selection.Add(memberRow)
        await Promise.resolve()
        await Promise.resolve()
        expect(explorer.opened).toHaveLength(0)   // a member row has no content path
    })

    it('a multi-selection does not open (bulk gesture, not navigation)', async () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)
        const member = manager.ActiveSolution!.Members.Get(0)
        const f1 = { ExtObject: { Path: 'a.todl', Kind: 'todl' }, Parent: memberRow, Id: 0 } as unknown as HierarchyItem
        const f2 = { ExtObject: { Path: 'b.todl', Kind: 'todl' }, Parent: memberRow, Id: 1 } as unknown as HierarchyItem
        svc.Hierarchy!.Selection.Add(f1)
        svc.Hierarchy!.Selection.Add(f2)
        await Promise.resolve()
        await Promise.resolve()
        // Only the first (single-item) selection opened — as a preview; the second made it a multi-selection.
        expect(explorer.opened).toEqual([[member, 'a.todl', 'todl', true]])
    })

    it('activating a member row (not a file) does not call OpenMemberFile', () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)   // child 0 under the Solution root is the Connections branch
        memberRow.OnActivate()
        expect(explorer.opened).toHaveLength(0)   // a member row's ExtObject is a SolutionMember, not a file
    })

    it('dispose stops following ActiveSolution and clears the Hierarchy', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        svc.dispose()
        expect(svc.Hierarchy).toBeUndefined()
        manager.SetActive(solutionWith('later'))   // ignored after dispose
        expect(svc.Hierarchy).toBeUndefined()
    })

    it('BuildActions concats the registered contributors for the node key', () =>
    {
        const { svc, manager } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)   // child 0 under the Solution root is the Connections branch
        const titles = svc.Hierarchy!.BuildActions(memberRow, actionCtx(memberRow)).ToArray().map((a) => a.Title)
        expect(titles).toContain('Remove from Solution')
    })

    it('the project-row menu services resolve an app-root submenu contributor (parent fallback)', () =>
    {
        // C2: SkillRunSubmenuContributor is registered only in the app root. buildMenuServices()
        // now creates a CHILD scope of the service provider, so CommandMenuBuilder.RealizeChildren
        // resolves it via the parent chain. A parentless provider (the old bug) found no owner and
        // threw when the "Run Agent / Skill ▸" submenu opened.
        const root = new ServiceProvider()
        root.registerInstance(SkillRunSubmenuContributor.Key, new SkillRunSubmenuContributor(root))
        expect(() => new ServiceProvider().getRequired(SkillRunSubmenuContributor.Key)).toThrow()
        const menuServices = root.createScope()
        expect(menuServices.getRequired(SkillRunSubmenuContributor.Key)).toBeInstanceOf(SkillRunSubmenuContributor)
    })

    it('committing a rename on a file row routes to mutations with the row member', async () =>
    {
        const { svc, manager, explorer } = make()
        svc.Start()
        manager.SetActive(solutionWith('a'))
        const memberRow = projectRow(svc, 0)   // child 0 under the Solution root is the Connections branch
        const member = manager.ActiveSolution!.Members.Get(0)
        const fileVm = { ExtObject: { Path: 'a.todl', Kind: 'todl' }, Parent: memberRow, Id: 0 } as unknown as HierarchyItem
        svc.CommitRename(fileVm, 'b.todl')
        await Promise.resolve()
        expect(explorer.renamed.at(-1)).toEqual([member, 'a.todl', 'b.todl'])
    })
})
