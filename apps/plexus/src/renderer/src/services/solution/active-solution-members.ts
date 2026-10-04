// The app-side read/subscribe view over the engine's active solution members
// (SolutionManagerService.ActiveSolution.Members). It replaces the retired
// ProjectExplorerService.OpenProjects collection for consumers that only need
// to enumerate resolved projects and react when that set changes.
//
// "Resolved" mirrors what OpenProjects used to contain: a member whose Project
// and Storage the engine has opened. Unresolved members (still opening, unknown
// type, load failure) are skipped on read; their later resolution re-notifies.
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { CollectionChange } from '@pragmatic-tech-ai/mural/runtime'
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionManagerService, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { Project } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project.js'

// A resolved member flattened to the pieces consumers use.
export interface IResolvedProject
{
    readonly Member: SolutionMember
    readonly Project: Project
    readonly Storage: IStorage
    // Project root path (the dedupe/watch key).
    readonly Folder: string
    readonly Name: string
}

// The slice of a resolved project that model/binding code needs. OpenProject
// satisfies it structurally, so callers not yet migrated off the explorer can
// still pass one.
export type IProjectHandle = Pick<IResolvedProject, 'Project' | 'Storage'>

export interface IMembersSubscription
{
    dispose(): void
}

export class ActiveSolutionMembers
{
    private static readonly ActiveSolutionProperty = 'ActiveSolution'
    private static readonly ProjectProperty = 'Project'
    private static readonly StatusProperty = 'Status'

    constructor(private readonly manager: SolutionManagerService | undefined) {}

    public static From(provider: IServiceProvider): ActiveSolutionMembers
    {
        return new ActiveSolutionMembers(provider.get(SolutionManagerService.Key))
    }

    // Every resolved member of the active solution, in Members order.
    public Resolved(): IResolvedProject[]
    {
        const members = this.manager?.ActiveSolution?.Members
        if (members === undefined) return []
        const out: IResolvedProject[] = []
        for (const member of members.ToArray())
        {
            const project = member.Project as Project | undefined
            const storage = member.Storage
            if (project === undefined || storage === undefined) continue
            out.push({ Member: member, Project: project, Storage: storage, Folder: project.RootPath, Name: project.Name })
        }
        return out
    }

    // Call `onChange` whenever the resolved set may have changed: the active
    // solution switches, a member is added/removed, or a member (re)resolves.
    public Subscribe(onChange: () => void): IMembersSubscription
    {
        const manager = this.manager
        if (manager === undefined) return { dispose: () => undefined }
        let inner: Array<() => void> = []
        const teardownInner = (): void =>
        {
            for (const d of inner) d()
            inner = []
        }
        const watchMember = (member: SolutionMember): void =>
        {
            const project = member.PropertyChanged(ActiveSolutionMembers.ProjectProperty).subscribe(() => onChange())
            const status = member.PropertyChanged(ActiveSolutionMembers.StatusProperty).subscribe(() => onChange())
            inner.push(() => project.dispose(), () => status.dispose())
        }
        const rewire = (): void =>
        {
            teardownInner()
            const members = manager.ActiveSolution?.Members
            if (members === undefined) return
            for (const member of members.ToArray()) watchMember(member)
            inner.push(members.Subscribe((change: CollectionChange<SolutionMember>) =>
            {
                if (change.kind === 'inserted') for (const member of change.items) watchMember(member)
                onChange()
            }))
        }
        const active = manager.PropertyChanged(ActiveSolutionMembers.ActiveSolutionProperty).subscribe(() =>
        {
            rewire()
            onChange()
        })
        rewire()
        return {
            dispose: () =>
            {
                active.dispose()
                teardownInner()
            },
        }
    }
}
