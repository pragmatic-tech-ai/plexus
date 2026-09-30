import { DurableApplicationStore, DurableApplicationStoreKey } from '@pragmatic-tech-ai/todl-runtime'
import type { IServiceContainer, IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'

// Startup wiring for the durable application store. SolutionManagerService's constructor optionally
// registers its session bag with whatever store answers DurableApplicationStoreKey; before this ran,
// nothing bound that key, so the last-active solution never persisted across runs (a dormant bug).
//
// Register MUST run before the manager is first constructed, and the caller must await the store's
// Restore() after the manager exists (so its session bag is registered) and before RestoreSession()
// (so the restored slice is in place). The store is a singleton, so the manager and the startup
// Restore share one instance.
export class DurableStoreRegistration
{
    public static Register(container: IServiceContainer): void
    {
        container.register(DurableApplicationStoreKey, (provider: IServiceProvider) => new DurableApplicationStore(provider))
    }
}
