import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import type { ProjectFileFormat } from '../../../projects/project-factory.js'
import type { VersionPart } from '../../../projects/semver-bump.js'

// The member-keyed mutation surface the Solution Explorer's contributors + host call.
// Implemented by SolutionWorkspaceService, which
// keeps open-doc relocation / close-guard / dialogs). One seam so contributors don't
// depend on the whole service.
export interface IContentMutations
{
    RenameMemberFile(member: SolutionMember, path: string, newName: string): Promise<void>
    // Delete one or more files/folders under a member in a single operation: ONE
    // confirmation for the whole batch (a single item names it; N items say "these N"),
    // then the recursive disk deletes. The menu Delete and the Delete key both route here.
    DeleteMemberFiles(member: SolutionMember, paths: readonly string[]): Promise<void>
    NewFileForMember(member: SolutionMember, folder: string, format: ProjectFileFormat): Promise<void>
    NewFolderForMember(member: SolutionMember, folder: string, name: string): Promise<void>
    ImportFilesForMember(member: SolutionMember, target: string): Promise<void>
    ImportFolderForMember(member: SolutionMember, target: string): Promise<void>
    MoveMemberNodes(member: SolutionMember, paths: readonly string[], destPath: string): Promise<void>
    // Ensure the member's generated content (generated/model.ts, generated/app.mu) is
    // present before a build requires it — runs the project's content generators against
    // its now-resolved bases. Idempotent (only produces files that are missing). Closes the
    // gap where a project opened before its bases were published never regenerated.
    EnsureMemberGenerated(member: SolutionMember): Promise<void>
    PublishMember(member: SolutionMember): Promise<void>
    BumpMemberVersion(member: SolutionMember, part: VersionPart): Promise<void>
    SetMemberVersion(member: SolutionMember): Promise<void>
    ManageMemberReferences(member: SolutionMember): Promise<void>
    RefreshMemberBases(member: SolutionMember): void
    UpdateMemberAgentMetadata(member: SolutionMember): Promise<void>
    CloseMember(member: SolutionMember): Promise<void>
    // Remove a member from the solution: a projected member goes through the dirty-tab-guarded
    // close; an unresolved/never-projected member is dropped from Members directly.
    RemoveMember(member: SolutionMember): Promise<void>
    FormatsFor(member: SolutionMember): readonly ProjectFileFormat[]
    IsVersionedMember(member: SolutionMember): boolean
    CanRefreshBasesMember(member: SolutionMember): boolean
    SupportsScaffoldMember(member: SolutionMember): boolean
}
