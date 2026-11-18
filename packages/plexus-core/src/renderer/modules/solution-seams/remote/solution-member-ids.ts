import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { Solution } from '@pragmatic-tech-ai/todl'
import type { IRemoteMemberIds } from './remote-language-service.js'

// The production IRemoteMemberIds: over the opened solution's members, a member's wire id is its
// manifest path (Ref.path, which is what the environment's model/view endpoint keys on) and its
// storage is the member's opened Storage. The solution is read lazily, so a solution opened or
// replaced after construction is seen.
export class SolutionMemberIds implements IRemoteMemberIds
{
    public constructor(private readonly activeSolution: () => Solution | undefined)
    {
    }

    public MemberIdOf(storage: IStorage): string | undefined
    {
        if (!storage) return undefined
        return this.activeSolution()?.Members.ToArray().find(member => member.Storage === storage)?.Ref.path
    }

    public StorageOfMember(memberId: string): IStorage | undefined
    {
        return this.activeSolution()?.Members.ToArray().find(member => member.Ref.path === memberId)?.Storage
    }
}
