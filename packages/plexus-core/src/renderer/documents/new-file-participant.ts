import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../projects/open-project.js'

// Optional post-new-file hook the ProjectExplorer calls after creating a file
// (before opening it). A no-op when unregistered — keeps the generic explorer
// decoupled from project-type-specific creation behavior (e.g. the architecture
// viewpoint picker).
//
// Returns whether to KEEP the created file: `false` aborts creation and the
// explorer deletes the file (e.g. the user cancelled a required setup dialog);
// `true` proceeds to open it. An unregistered participant is treated as `true`.
export interface INewFileParticipant
{
    OnCreated(op: OpenProject, path: string): Promise<boolean>
}

export const NewFileParticipantKey = new ServiceKey<INewFileParticipant>('NewFileParticipant')
