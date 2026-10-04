// The app-side read/subscribe view over the engine's active solution members
// (SolutionManagerService.ActiveSolution.Members). It replaces the retired
// OpenProjects collection of the retired ProjectExplorerService for consumers that only need
// to enumerate resolved projects and react when that set changes.
//
// "Resolved" mirrors what OpenProjects used to contain: a member whose Project
// and Storage the engine has opened. Unresolved members (still opening, unknown
// type, load failure) are skipped on read; their later resolution re-notifies.
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
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

// The slice of a resolved project that model/binding code needs. IResolvedProject
// and OpenProject both satisfy it structurally.
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

    // Fail-fast: every host that runs these consumers registers the manager.
    public static From(provider: IServiceProvider): ActiveSolutionMembers
    {
        return new ActiveSolutionMembers(provider.getRequired(SolutionManagerService.Key))
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

    // The resolved project a member is projected onto, or undefined (unresolved / closed).
    public HandleFor(member: SolutionMember): IResolvedProject | undefined
    {
        return this.Resolved().find((r) => r.Member === member)
    }

    // Call `onChange` whenever the resolved set may have changed: the active
    // solution switches, a member is added/removed/replaced/cleared/reset, or a
    // member (re)resolves. Per-member subscriptions are kept in a map reconciled
    // against the live collection on every change, so removed members are released
    // immediately and every CollectionChange kind is handled.
    public Subscribe(onChange: () => void): IMembersSubscription
    {
        const manager = this.manager
        if (manager === undefined) return { dispose: () => undefined }
        const perMember = new Map<SolutionMember, () => void>()
        let collection: (() => void) | undefined
        const releaseAll = (): void =>
        {
            for (const d of perMember.values()) d()
            perMember.clear()
        }
        const reconcile = (): void =>
        {
            const current = new Set(manager.ActiveSolution?.Members.ToArray() ?? [])
            for (const [member, dispose] of [...perMember])
            {
                if (current.has(member)) continue
                dispose()
                perMember.delete(member)
            }
            for (const member of current)
            {
                if (perMember.has(member)) continue
                const project = member.PropertyChanged(ActiveSolutionMembers.ProjectProperty).subscribe(() => onChange())
                const status = member.PropertyChanged(ActiveSolutionMembers.StatusProperty).subscribe(() => onChange())
                perMember.set(member, () => { project.dispose(); status.dispose() })
            }
        }
        const rewire = (): void =>
        {
            collection?.()
            collection = undefined
            releaseAll()
            const members = manager.ActiveSolution?.Members
            reconcile()
            if (members === undefined) return
            collection = members.Subscribe(() =>
            {
                reconcile()
                onChange()
            })
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
                collection?.()
                collection = undefined
                releaseAll()
            },
        }
    }
}
