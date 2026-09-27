import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { ProjectType, DependencyRef } from '@pragmatic-tech-ai/todl'

// Resolves bases for the active solution — reshaped (W3b Task 5) to bind
// directly to TODL's SolutionBaseResolver: a structural match, so
// BaseResolverKey needs no adapter. Only the two members plexus-core's
// consumers (project-explorer-service.ts) drive through this capability are
// declared here; SolutionBaseResolver's other members (ResolveBasesFor,
// ReferencedPublishedRefs, Invalidate, …) are consumed directly against its
// own Key by the app-side direct consumers.
export interface IBaseResolver
{
    WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>
    ProducedIdOf(storage: IStorage): Promise<string | undefined>
}

export const BaseResolverKey = new ServiceKey<IBaseResolver>('IBaseResolver')
