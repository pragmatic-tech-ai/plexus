import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import type { ProjectFileFormat } from '../../../projects/project-factory.js'
import type { VersionPart } from '../../../projects/semver-bump.js'

// The member-keyed mutation surface the Solution Explorer's contributors + host call.
// Implemented by ProjectExplorerService (which resolves the projected OpenProject and
// keeps open-doc relocation / close-guard / dialogs). One seam so contributors don't
// depend on the whole service.
export interface IContentMutations
{
    RenameMemberFile(member: SolutionMember, path: string, newName: string): Promise<void>
    DeleteMemberFile(member: SolutionMember, path: string): Promise<void>
    NewFileForMember(member: SolutionMember, folder: string, format: ProjectFileFormat): Promise<void>
    NewFolderForMember(member: SolutionMember, folder: string, name: string): Promise<void>
    ImportFilesForMember(member: SolutionMember, target: string): Promise<void>
    ImportFolderForMember(member: SolutionMember, target: string): Promise<void>
    MoveMemberNodes(member: SolutionMember, paths: readonly string[], destPath: string): Promise<void>
    PublishMember(member: SolutionMember): Promise<void>
    BumpMemberVersion(member: SolutionMember, part: VersionPart): Promise<void>
    SetMemberVersion(member: SolutionMember): Promise<void>
    ManageMemberReferences(member: SolutionMember): Promise<void>
    RefreshMemberBases(member: SolutionMember): void
    UpdateMemberAgentMetadata(member: SolutionMember): Promise<void>
    CloseMember(member: SolutionMember): Promise<void>
    FormatsFor(member: SolutionMember): readonly ProjectFileFormat[]
    IsVersionedMember(member: SolutionMember): boolean
    CanRefreshBasesMember(member: SolutionMember): boolean
    SupportsScaffoldMember(member: SolutionMember): boolean
}

export const ContentMutationsKey = new ServiceKey<IContentMutations>('ContentMutations')
