import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { ProjectType, DependencyRef } from '@pragmatic-tech-ai/todl'

// Resolves bases for the active solution. The app binds BaseResolverKey to the
// registered SolutionLanguageService (LSP Wave 2), which implements TODL's
// IBaseResolver — a structural superset — so this key needs no adapter. Only the
// two members plexus-core's consumers (the solution-explorer services) drive
// through this capability are declared here; the service's other base-resolution
// members (ResolveBasesFor, ReferencedPublishedRefs, Invalidate, …) are consumed
// directly against SolutionLanguageService.Key by the app-side consumers.
export interface IBaseResolver
{
    WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>
    ProducedIdOf(storage: IStorage): Promise<string | undefined>
}

export const BaseResolverKey = new ServiceKey<IBaseResolver>('IBaseResolver')
