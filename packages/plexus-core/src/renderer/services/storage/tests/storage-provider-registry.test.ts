import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { StorageProviderRegistryBase } from '../storage-provider-registry.js'

// A minimal concrete registry for the tests: registers a fake 'local' backend so
// the shared base mechanics can be exercised without an app's real storage.
class TestRegistry extends StorageProviderRegistryBase
{
    constructor(provider: ServiceProvider)
    {
        super(provider)
        this.Register(StorageProviderRegistryBase.DefaultBackendId, (loc) => new FakeStorage(loc))
    }
}

function reg(): TestRegistry
{
    return new TestRegistry(new ServiceProvider())
}

test('the default backend is registered by the subclass ctor', () => {
    expect(reg().Has(StorageProviderRegistryBase.DefaultBackendId)).toBe(true)
})

test('Create(default, folder) builds the registered storage', () => {
    expect(reg().Create(StorageProviderRegistryBase.DefaultBackendId, 'mem://p')).toBeInstanceOf(FakeStorage)
})

test('CreateStorage uses the default backend', () => {
    expect(reg().CreateStorage('mem://p')).toBeInstanceOf(FakeStorage)
})

test('an unknown backend id throws', () => {
    expect(() => reg().Create('cloud', 'x')).toThrow('Unknown storage backend "cloud".')
})

test('a custom backend can be registered and resolved', () => {
    const r = reg()
    const fake = new FakeStorage('mem://x')
    r.Register('memory', () => fake)
    expect(r.Has('memory')).toBe(true)
    expect(r.Create('memory', 'ignored')).toBe(fake)
})
