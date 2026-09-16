import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { WorkspaceBaseResolver } from '../../projects/workspace-base-resolver.js'

// The language client resolves a project's bases through WorkspaceBaseResolver.
// These unit tests don't exercise base resolution, so register a stub that
// returns no bases (matching the old "no manifest → []" behavior).
export function providerWithFakeResolver(): ServiceProvider
{
    const provider = new ServiceProvider()
    provider.registerInstance(WorkspaceBaseResolver.Key, {
        ResolveForStorage: async () => ({ bases: [], problems: [] }),
    } as unknown as WorkspaceBaseResolver)
    return provider
}
