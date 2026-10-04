// Test double for SolutionManagerService: just the ActiveSolution seam (with a
// real Solution + real SolutionMember records) that ActiveSolutionMembers reads.
import type { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Solution, SolutionManagerService, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { Observable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'

export interface IFakeProject
{
    RootPath: string
    Name: string
    Type?: string
}

export class FakeSolutionManager extends Observable
{
    private static readonly ActiveSolutionProperty = 'ActiveSolution'
    private static readonly MemberType = 'fake'
    private static readonly SolutionName = 'fake-solution'

    private active: Solution | undefined = new Solution(FakeSolutionManager.SolutionName)

    public get ActiveSolution(): Solution | undefined { return this.active }

    public set ActiveSolution(v: Solution | undefined)
    {
        const old = this.active
        this.active = v
        this.RaisePropertyChanged(FakeSolutionManager.ActiveSolutionProperty, old, v)
    }

    // Add a member and mark it resolved (Project + Storage set), like the engine
    // does after OpenMembers.
    public AddResolved(project: IFakeProject, storage: IStorage | object = {}): SolutionMember
    {
        const member = this.active!.AddMember(project.RootPath, project.Type ?? FakeSolutionManager.MemberType)
        member.Storage = storage as IStorage
        member.Project = project
        return member
    }

    // Add a member that has not resolved yet.
    public AddUnresolved(path: string): SolutionMember
    {
        return this.active!.AddMember(path, FakeSolutionManager.MemberType)
    }

    public Remove(member: SolutionMember): void
    {
        this.active!.RemoveMember(member)
    }

    public RegisterOn(provider: ServiceProvider): void
    {
        provider.registerInstance(SolutionManagerService.Key, this as unknown as SolutionManagerService)
    }
}
