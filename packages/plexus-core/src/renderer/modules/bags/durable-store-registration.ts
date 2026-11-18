import { DurableApplicationStore, DurableApplicationStoreKey, StorageProviderKey } from '@pragmatic-tech-ai/todl-runtime'
import type { IServiceContainer, IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { GlobalBagPersister, GlobalBagPersisterKey } from './global-bag-persister.js'
import { StorageService } from '../storage/index.js'

// Startup wiring for the durable application store + the global bag persister over it.
// SolutionManagerService's constructor optionally registers its session bag with whatever store
// answers DurableApplicationStoreKey; before this ran, nothing bound that key, so the last-active
// solution never persisted across runs (a dormant bug).
//
// Register MUST run before the manager is first constructed, and the caller must await the store's
// Restore() after the manager exists (so its session bag is registered) and before RestoreSession()
// (so the restored slice is in place). Both services are singletons — the manager, the startup
// Restore, connection resolution, and the bag migration all share ONE store and ONE
// GlobalBagPersister (a second persister would double-register the store's aggregate key and throw).
export class DurableStoreRegistration
{
    public static Register(container: IServiceContainer): void
    {
        container.register(DurableApplicationStoreKey, (provider: IServiceProvider) => new DurableApplicationStore(provider))
        container.register(GlobalBagPersisterKey, (provider: IServiceProvider) => new GlobalBagPersister(provider.getRequired(DurableApplicationStoreKey)))
        // The durable store persists to StorageProviderKey.CreateStorage(UserDataDirectory). The
        // renderer's IStorageProvider is StorageService (registered under its own Key by the Storage
        // module), but nothing bound the todl-runtime StorageProviderKey to it — so Save() threw and
        // application-bags.json (lastSolution + recents) never persisted. Alias the two here.
        container.register(StorageProviderKey, (provider: IServiceProvider) => provider.getRequired(StorageService.Key))
    }
}
