// member-projection.ts — the pure mapping from a TODL SolutionMember (the
// solution-services engine's record of one solution member: its ref + resolved
// Project/Storage) to a Plexus OpenProject (the explorer's per-project VM).
//
// Isolated from ProjectExplorerService's sync loop (which will consume it in a
// later task) so the mapping — and its unresolved-member handling — is testable
// without the service's open-set bookkeeping or command wiring.
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'

import { ProjectFactoryRegistryKey } from '../../../projects/project-factory.js'
import { OpenProject } from '../../../projects/open-project.js'
import type { Project } from '../../../projects/project.js'

// Thrown by MemberProjection.Build for a SolutionMember that cannot yet be
// projected: no factory is registered for its Ref.type, or the member's
// engine-resolved Project/Storage are still undefined (SolutionMember.IsResolved
// false). Callers are expected to project only members Solution.OpenMembers /
// OpenOne already resolved, so this signals a caller bug rather than a routine
// outcome.
export class UnresolvedSolutionMemberError extends Error
{
    private static readonly MessageText = 'Cannot project unresolved solution member'

    constructor(member: SolutionMember)
    {
        super(`${UnresolvedSolutionMemberError.MessageText}: ${member.Ref.path} (${member.Ref.type})`)
    }
}

export class MemberProjection
{
    constructor(private readonly provider: IServiceProvider) {}

    // Build the OpenProject for a resolved member. Throws
    // UnresolvedSolutionMemberError when no factory is registered for the
    // member's Ref.type, or its Project/Storage are not yet resolved.
    public Build(member: SolutionMember): OpenProject
    {
        const factory = this.provider.getRequired(ProjectFactoryRegistryKey).factoryFor(member.Ref.type)
        const project = member.Project as Project | undefined
        const storage = member.Storage
        if (factory === undefined || project === undefined || storage === undefined)
        {
            throw new UnresolvedSolutionMemberError(member)
        }
        return new OpenProject(project, factory, storage)
    }

    // The dedupe/persist key for a member: the resolved project's root path,
    // else (before/without resolution) the member's declared ref path.
    public FolderOf(member: SolutionMember): string
    {
        const project = member.Project as Project | undefined
        return project?.RootPath ?? member.Ref.path
    }
}
