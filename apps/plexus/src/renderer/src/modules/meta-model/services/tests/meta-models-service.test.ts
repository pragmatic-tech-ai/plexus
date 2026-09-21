import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { buildCatalog } from '../meta-model-tree-builder.js'
import { MetaModelsService, dependentLibraryNames } from '../meta-models-service.js'
import { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PACKAGES_BACKEND_ID } from '../../../../services/projects/packages-backend.js'
import type { LoadedLibrary } from '../../../library/services/library-loader.js'

const NO_ACTIVATE = (): void => {}
const NO_DELETE = (): void => {}

// The service's reload logic is `buildCatalog(backend)` → Nodes; exercise the
// builder directly against a seeded backend to assert the shape the panel binds.
test('buildCatalog produces the Model→Version node tree the service binds as Nodes', async () => {
    const storage = new FakeStorage('fake://packages')
    await storage.WriteText('tech/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))
    await storage.WriteText('tech/0.1.0/bundle.json', JSON.stringify({ type: 'meta-model' }))   // meta-model discriminator

    const nodes = await buildCatalog(storage, NO_ACTIVATE, NO_DELETE)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].Kind).toBe(MetaModelNodeKind.Model)
    expect(nodes[0].Children.Get(0)!.Kind).toBe(MetaModelNodeKind.Version)
})

test('buildCatalog on an empty backend yields no nodes (drives IsEmpty)', async () => {
    const nodes = await buildCatalog(new FakeStorage('fake://meta-models'), NO_ACTIVATE, NO_DELETE)
    expect(nodes).toHaveLength(0)
})

test('onMetaModelsChanged notifies subscribers after reload completes, and unsubscribes', async () => {
    const provider = new ServiceProvider()
    const reg = new StorageService(provider)
    const backend = new FakeStorage('fake://packages')
    reg.Register(PACKAGES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageService.Key, reg)
    const svc = new MetaModelsService(provider)
    await svc.reload()                 // settle the constructor's reload first
    let fired = 0
    const off = svc.onMetaModelsChanged(() => { fired++ })
    await svc.reload()
    expect(fired).toBe(1)
    off()
    await svc.reload()
    expect(fired).toBe(1)
})

// ── delete ───────────────────────────────────────────────────────────────

function lib(id: string, mmId: string, mmVersion: string): LoadedLibrary
{
    return { id, version: '0.1.0', name: id, metaModels: [{ id: mmId, version: mmVersion }], classes: [], problems: [] }
}

test('dependentLibraryNames filters by meta-model id and optional version', () => {
    const libs = [lib('l1', 'ea', '1.0.0'), lib('l2', 'ea', '2.0.0'), lib('l3', 'other', '1.0.0')]
    expect(dependentLibraryNames(libs, 'ea').sort()).toEqual(['l1', 'l2'])   // any version
    expect(dependentLibraryNames(libs, 'ea', '1.0.0')).toEqual(['l1'])       // exact version
    expect(dependentLibraryNames(libs, 'none')).toEqual([])
})

function deleteEnv(seed: (mm: FakeStorage) => void): { provider: ServiceProvider; mm: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageService(provider)
    const mm = new FakeStorage('fake://packages')
    registry.Register(PACKAGES_BACKEND_ID, () => mm)
    provider.registerInstance(StorageService.Key, registry)
    seed(mm)
    return { provider, mm }
}

test('deleteTarget removes one version and cleans an emptied id folder', async () => {
    const { provider, mm } = deleteEnv((s) => {
        void s.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.0.0/bundle.json', JSON.stringify({ type: 'meta-model' }))
        void s.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.1.0/bundle.json', JSON.stringify({ type: 'meta-model' }))
    })
    const svc = new MetaModelsService(provider)
    await svc.reload()

    await svc.deleteTarget({ id: 'a', version: '1.0.0' })
    expect(await mm.Exists('a/1.0.0')).toBe(false)
    expect(await mm.Exists('a/1.1.0')).toBe(true)      // sibling + id folder kept

    await svc.deleteTarget({ id: 'a', version: '1.1.0' })
    expect(await mm.Exists('a/1.1.0')).toBe(false)
    expect(await mm.Exists('a')).toBe(false)           // last version → id folder cleaned
})

test('deleteTarget removes a whole model (all versions)', async () => {
    const { provider, mm } = deleteEnv((s) => {
        void s.WriteText('a/1.0.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.0.0/bundle.json', JSON.stringify({ type: 'meta-model' }))
        void s.WriteText('a/1.1.0/model.json', '{"nodes":[],"edges":[]}')
        void s.WriteText('a/1.1.0/bundle.json', JSON.stringify({ type: 'meta-model' }))
    })
    const svc = new MetaModelsService(provider)
    await svc.reload()

    await svc.deleteTarget({ id: 'a' })
    expect(await mm.Exists('a')).toBe(false)
    expect(svc.Nodes.Count).toBe(0)
})

// ── discover on reload ────────────────────────────────────────────────────

// Verify that reload() triggers TodlPresentationRegistry.discover() so a
// just-published meta-model's visuals become available immediately after reload.
test('reload() calls TodlPresentationRegistry.discover() when the registry is registered', async () => {
    const provider = new ServiceProvider()
    const registry = new StorageService(provider)
    const mm = new FakeStorage('fake://packages')
    registry.Register(PACKAGES_BACKEND_ID, () => mm)
    provider.registerInstance(StorageService.Key, registry)

    let discoverCalled = false
    const fakeRegistry = {
        discover: async () => { discoverCalled = true },
    }
    provider.registerInstance(TodlPresentationRegistry.Key, fakeRegistry as unknown as TodlPresentationRegistry)

    const svc = new MetaModelsService(provider)
    // The ctor calls reload() asynchronously; run an explicit reload to assert.
    await svc.reload()

    expect(discoverCalled).toBe(true)
})

test('reload() does not throw when TodlPresentationRegistry is absent', async () => {
    const provider = new ServiceProvider()
    const registry = new StorageService(provider)
    const mm = new FakeStorage('fake://packages')
    registry.Register(PACKAGES_BACKEND_ID, () => mm)
    provider.registerInstance(StorageService.Key, registry)
    // No TodlPresentationRegistry registered — the ?.discover() guard must not throw.

    const svc = new MetaModelsService(provider)
    await expect(svc.reload()).resolves.toBeUndefined()
})
