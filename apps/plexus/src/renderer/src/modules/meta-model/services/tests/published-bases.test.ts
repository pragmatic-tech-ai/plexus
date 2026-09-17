import { test, expect } from 'vitest'
import { ServiceProvider, type IStorage } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'
import { PublishedBases } from '../published-bases.js'

// A backend whose List returns a fixed `<id>/<version>` directory tree.
class FakeBackend
{
    constructor(private readonly tree: Record<string, string[]>) { }
    async List(path: string): Promise<{ Name: string; IsDirectory: boolean }[]>
    {
        const names = path === '' ? Object.keys(this.tree) : (this.tree[path] ?? [])
        return names.map((Name) => ({ Name, IsDirectory: true }))
    }
}

function providerWith(mm: FakeBackend, lib: FakeBackend): ServiceProvider
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    registry.Register(META_MODELS_BACKEND_ID, () => mm as unknown as IStorage)
    registry.Register(LIBRARIES_BACKEND_ID, () => lib as unknown as IStorage)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    return provider
}

test('ListMetaModels enumerates <id>/<version> BaseRefs from the meta-models backend', async () => {
    const provider = providerWith(new FakeBackend({ ea: ['1.0.0', '1.1.0'] }), new FakeBackend({}))
    const bases = new PublishedBases(provider)
    expect(await bases.ListMetaModels()).toEqual([
        { id: 'ea', version: '1.0.0' },
        { id: 'ea', version: '1.1.0' },
    ])
})

test('ListLibraries enumerates from the libraries backend', async () => {
    const provider = providerWith(new FakeBackend({}), new FakeBackend({ util: ['2.0.0'] }))
    const bases = new PublishedBases(provider)
    expect(await bases.ListLibraries()).toEqual([{ id: 'util', version: '2.0.0' }])
})
