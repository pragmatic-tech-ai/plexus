import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PACKAGES_BACKEND_ID } from '../../../../services/projects/packages-backend.js'
import { PublishedBases } from '../published-bases.js'

// Wire a provider around a single packages backend. Under one root a package's kind
// is recovered from its unified bundle.json (checking `.type`: 'meta-model' vs
// 'library') — the enumerate-by-kind paths filter on that.
function providerWith(seed: (b: FakeStorage) => void): ServiceProvider
{
    const provider = new ServiceProvider()
    const registry = new StorageService(provider)
    const backend = new FakeStorage('fake://packages')
    registry.Register(PACKAGES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageService.Key, registry)
    seed(backend)
    return provider
}

function seedMeta(b: FakeStorage, id: string, version: string): void
{
    void b.WriteText(`${id}/${version}/model.json`, '{"nodes":[],"edges":[]}')
    void b.WriteText(`${id}/${version}/bundle.json`, JSON.stringify({ type: 'meta-model', id, version, name: id }))
}

function seedLibrary(b: FakeStorage, id: string, version: string): void
{
    void b.WriteText(`${id}/${version}/model.json`, '{"nodes":[],"edges":[]}')
    void b.WriteText(`${id}/${version}/bundle.json`, JSON.stringify({ type: 'library', id, version, name: id, metaModels: [{ id: 'ea', version: '5' }], classes: [] }))
}

test('ListMetaModels enumerates <id>/<version> BaseRefs for meta-model packages only', async () => {
    const provider = providerWith((b) => {
        seedMeta(b, 'ea', '1.0.0')
        seedMeta(b, 'ea', '1.1.0')
        seedLibrary(b, 'util', '2.0.0')   // a library — must NOT appear here
    })
    const bases = new PublishedBases(provider)
    expect(await bases.ListMetaModels()).toEqual([
        { id: 'ea', version: '1.0.0' },
        { id: 'ea', version: '1.1.0' },
    ])
})

test('ListLibraries enumerates library packages only', async () => {
    const provider = providerWith((b) => {
        seedMeta(b, 'ea', '1.0.0')        // a meta-model — must NOT appear here
        seedLibrary(b, 'util', '2.0.0')
    })
    const bases = new PublishedBases(provider)
    expect(await bases.ListLibraries()).toEqual([{ id: 'util', version: '2.0.0' }])
})
