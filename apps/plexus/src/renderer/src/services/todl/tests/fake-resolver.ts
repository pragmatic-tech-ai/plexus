import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionBaseResolver } from '@pragmatic-tech-ai/todl'

// The language client resolves a project's bases through SolutionBaseResolver.
// These unit tests don't exercise base resolution, so register a stub that
// returns no bases (matching the old "no manifest → []" behavior).
export function providerWithFakeResolver(): ServiceProvider
{
    const provider = new ServiceProvider()
    provider.registerInstance(SolutionBaseResolver.Key, {
        ResolveBasesFor: async () => ({ bases: [], problems: [] }),
    } as unknown as SolutionBaseResolver)
    return provider
}
