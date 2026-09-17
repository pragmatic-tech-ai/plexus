import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Live (as-you-type) validation of a project's TODL sources against its bases.
// The explorer drives lifecycle (attach on open, detach on close, resync/refresh
// on structural change); the impl (app-side, backed by the TODL language client)
// does the actual diagnostics. Method names match the language client so it
// registers under this key with no adapter.
export interface ILiveValidation
{
    AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void>
    DetachProject(storage: IStorage): void
    ResyncProject(projectId: string, storage: IStorage): Promise<void>
    RefreshBases(storage: IStorage): Promise<void>
}

export const LiveValidationKey = new ServiceKey<ILiveValidation>('ILiveValidation')
