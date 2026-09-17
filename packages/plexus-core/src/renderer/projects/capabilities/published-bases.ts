import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { BaseRef } from '../base-binding.js'

// Enumerates the meta-models and libraries published to the workspace's package
// registry, so the New Project pickers can offer them as bases. The impl
// (app-side) talks to the registry backends; core stays registry-agnostic.
export interface IPublishedBases
{
    listMetaModels(): Promise<BaseRef[]>
    listLibraries(): Promise<BaseRef[]>
}

export const PublishedBasesKey = new ServiceKey<IPublishedBases>('IPublishedBases')
