import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { BaseRef } from '../base-binding.js'
import type { ProducerKind } from '../project-factory.js'

// Resolves bases produced by *other open projects* in the workspace (local
// inter-project references) and drives re-validation of a producer's dependents
// when it changes. The impl (app-side) knows how producers publish; core only
// needs the workspace-producer list + the produced-id lookup.
export interface IBaseResolver
{
    workspaceProducers(kind: ProducerKind): Promise<BaseRef[]>
    producedIdOf(storage: IStorage): string | undefined
    refreshDependentsOfIds(ids: readonly string[]): Promise<void>
}

export const BaseResolverKey = new ServiceKey<IBaseResolver>('IBaseResolver')
