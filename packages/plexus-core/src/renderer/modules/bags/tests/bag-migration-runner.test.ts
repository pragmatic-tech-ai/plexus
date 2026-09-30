import { describe, it, expect } from 'vitest'
import { ServiceProvider, DurableApplicationStoreKey, EnvironmentKey, StorageProviderKey, FakeStorage, type IPropertyBag, type IPropertyBagStore, type Disposable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ConnectionBag, ConnectionBagKind } from '@pragmatic-tech-ai/todl'
import { BagMigrationRunner } from '../bag-migration-runner.js'
import { GlobalBagPersister, GlobalBagPersisterKey } from '../global-bag-persister.js'

class FakeStore implements IPropertyBagStore
{
    private readonly tracked = new Map<string, IPropertyBag>()
    public Register(key: string, bag: IPropertyBag): Disposable { this.tracked.set(key, bag); return { dispose: () => { this.tracked.delete(key) } } }
    public Restore(): Promise<void> { return Promise.resolve() }
    public Save(): Promise<void> { return Promise.resolve() }
}

const CONNECTIONS_JSON = JSON.stringify({
    version: 2,
    defaultId: 'gh',
    connections: [{ Id: 'gh', DisplayName: 'GitHub', RegistryType: 'npm', Settings: {}, TokenSource: 'stored' }],
})

function providerWith(userDataStorage: IStorage): ServiceProvider
{
    const provider = new ServiceProvider()
    const store = new FakeStore()
    provider.registerInstance(DurableApplicationStoreKey, store)
    provider.registerInstance(EnvironmentKey, { UserDataDirectory: '/u' } as never)
    provider.registerInstance(StorageProviderKey, { CreateStorage: () => userDataStorage })
    provider.register(GlobalBagPersisterKey, (p) => new GlobalBagPersister(p.getRequired(DurableApplicationStoreKey)))
    return provider
}

describe('BagMigrationRunner.RunGlobal', () =>
{
    it('lifts connections.json into the global bag persister and is idempotent', async () =>
    {
        const storage = new FakeStorage('/u')
        await storage.WriteText('connections.json', CONNECTIONS_JSON)
        const provider = providerWith(storage)

        await BagMigrationRunner.RunGlobal(provider)

        const global = provider.getRequired(GlobalBagPersisterKey)
        expect([...global.Ids(ConnectionBagKind)]).toEqual(['gh'])
        const gh = new ConnectionBag(global.Bag(ConnectionBagKind, 'gh'))
        expect(gh.DisplayName).toBe('GitHub')
        expect(gh.IsDefault).toBe(true)
        expect(gh.TokenRef).toBe('gh')

        // Second run holds the marker: still exactly one connection, no throw.
        await BagMigrationRunner.RunGlobal(provider)
        expect([...global.Ids(ConnectionBagKind)]).toEqual(['gh'])
    })

    it('no-ops when the durable store is unavailable', async () =>
    {
        await expect(BagMigrationRunner.RunGlobal(new ServiceProvider())).resolves.toBeUndefined()
    })
})
