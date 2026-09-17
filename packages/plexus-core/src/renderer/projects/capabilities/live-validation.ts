import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Live (as-you-type) validation of a project's TODL sources against its bases.
// The explorer drives lifecycle (attach on open, detach on close, resync/refresh
// on structural change); the impl (app-side, backed by the TODL language client)
// does the actual diagnostics.
export interface ILiveValidation
{
    attachProject(rootPath: string, name: string, storage: IStorage): void
    detachProject(storage: IStorage): void
    resyncProject(rootPath: string, storage: IStorage): void
    refreshBases(storage: IStorage): Promise<void> | void
}

export const LiveValidationKey = new ServiceKey<ILiveValidation>('ILiveValidation')
