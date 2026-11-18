import { describe, it, expect } from 'vitest'
import { ServiceProvider, DurableApplicationStore, DurableApplicationStoreKey, StorageProviderKey } from '@pragmatic-tech-ai/todl-runtime'
import { DurableStoreRegistration } from '../durable-store-registration.js'
import { StorageService } from '../../storage/index.js'

describe('DurableStoreRegistration', () =>
{
    it('binds DurableApplicationStoreKey to a concrete DurableApplicationStore singleton', () =>
    {
        const container = new ServiceProvider()
        DurableStoreRegistration.Register(container)

        expect(container.has(DurableApplicationStoreKey)).toBe(true)
        const first = container.getRequired(DurableApplicationStoreKey)
        const second = container.getRequired(DurableApplicationStoreKey)
        expect(first).toBeInstanceOf(DurableApplicationStore)
        expect(first).toBe(second)   // singleton — the manager and the startup Restore share one store
    })

    it('binds StorageProviderKey to the registered StorageService so the durable store can persist', () =>
    {
        // Without this, DurableApplicationStore.Save() -> storage() -> getRequired(StorageProviderKey)
        // throws, so application-bags.json (lastSolution + recents) is never written.
        const container = new ServiceProvider()
        const storage = { CreateStorage: () => ({}) }
        container.register(StorageService.Key, () => storage as unknown as StorageService)
        DurableStoreRegistration.Register(container)

        expect(container.has(StorageProviderKey)).toBe(true)
        expect(container.getRequired(StorageProviderKey)).toBe(container.getRequired(StorageService.Key))
    })
})
