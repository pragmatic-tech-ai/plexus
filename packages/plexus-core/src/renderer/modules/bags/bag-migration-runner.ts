import { DurableApplicationStoreKey, EnvironmentKey, StorageProviderKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { BagMigration, type IBagPersister } from '@pragmatic-tech-ai/todl'
import { GlobalBagPersisterKey } from './global-bag-persister.js'

// Runs the one-shot bag migrations at the app's startup / solution-open seams. The migration LOGIC
// (idempotent via a per-scope marker) lives in todl's BagMigration; this wires the app's services to
// it. RunGlobal lifts userData/connections.json into the global bags once; RunSolution lifts a
// legacy solution's per-member connection overrides into project-local selections.
export class BagMigrationRunner
{
    // Migrate the global connections.json → global npm-connection bags. No-op when the durable store
    // or its storage seams are unavailable (a headless context) or when the marker is already set.
    public static async RunGlobal(provider: IServiceProvider): Promise<void>
    {
        const store = provider.get(DurableApplicationStoreKey)
        const environment = provider.get(EnvironmentKey)
        const storageProvider = provider.get(StorageProviderKey)
        const global = provider.get(GlobalBagPersisterKey)
        if (store === undefined || environment === undefined || storageProvider === undefined || global === undefined) return
        const userData = storageProvider.CreateStorage(environment.UserDataDirectory)
        await new BagMigration().MigrateGlobal(userData, global)
    }

    // Migrate a legacy solution's per-member connection overrides (memberPath → connection id) into
    // each member's project-local connection-selection. Idempotent via the solution-scope marker.
    public static RunSolution(
        overrides: ReadonlyMap<string, string>,
        solutionMarker: IBagPersister,
        projectLocalFor: (memberPath: string) => IBagPersister | undefined,
    ): Promise<void>
    {
        return new BagMigration().MigrateSolution(overrides, solutionMarker, projectLocalFor)
    }
}
