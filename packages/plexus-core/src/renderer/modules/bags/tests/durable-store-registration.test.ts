import { describe, it, expect } from 'vitest'
import { ServiceProvider, DurableApplicationStore, DurableApplicationStoreKey } from '@pragmatic-tech-ai/todl-runtime'
import { DurableStoreRegistration } from '../durable-store-registration.js'

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
})
