import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'
import { MetaModelPresentationSource } from '../meta-model-presentation-source.js'

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

const DOC: TodlDocument = {
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Application' } },
        { id: 'application@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/app.svg' } },
    ],
    edges: [{ kind: 'Annotated', via: null, from: 'application', to: 'application@icon' }],
} as unknown as TodlDocument

// Wire a provider whose meta-models backend is the given FakeStorage.
function envWith(backend: FakeStorage): ServiceProvider {
    const provider = new ServiceProvider()
    const storageRegistry = new StorageProviderRegistry(provider)
    storageRegistry.Register(META_MODELS_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, storageRegistry)
    return provider
}

// Bake a real compiled presentation for DOC into `backend` under `<id>/<version>/…`.
async function bakePresentation(backend: FakeStorage, id: string, version: string): Promise<void> {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/app.svg', SVG)
    const { publishPresentation } = await import('../presentation-publisher.js')
    const res = await publishPresentation(project, backend, `${id}/${version}`, DOC)
    expect(res.ok).toBe(true)
}

// ── happy path ────────────────────────────────────────────────────────────────

test('load() contributes the baked icon asset + a mm: icon-key index for a baked meta-model', async () => {
    const backend = new FakeStorage('fake://meta-models')
    await bakePresentation(backend, 'ea', '1.0.0')
    const source = new MetaModelPresentationSource(envWith(backend))
    const { assets, iconKeys } = await source.load()
    expect(assets.CanResolve('mm_icon_app')).toBe(true)
    expect(iconKeys.get('mm:application')).toBe('mm_icon_app')
})

// ── missing presentation artifact ────────────────────────────────────────────

test('a published model dir with no presentation artifact contributes nothing (no throw)', async () => {
    const backend = new FakeStorage('fake://meta-models')
    await backend.WriteText('ea/1.0.0/model.json', JSON.stringify({ nodes: [], edges: [] }))
    const source = new MetaModelPresentationSource(envWith(backend))
    const { assets, iconKeys } = await source.load()
    expect(assets.CanResolve('mm_icon_app')).toBe(false)
    expect(iconKeys.size).toBe(0)
})

// ── empty backend ─────────────────────────────────────────────────────────────

test('empty backend yields an empty contribution', async () => {
    const backend = new FakeStorage('fake://meta-models')
    const source = new MetaModelPresentationSource(envWith(backend))
    const { iconKeys } = await source.load()
    expect(iconKeys.size).toBe(0)
})

// ── multiple models / versions ────────────────────────────────────────────────

test('multiple published versions each contribute their mm: keys (last wins)', async () => {
    const backend = new FakeStorage('fake://meta-models')
    await bakePresentation(backend, 'ea', '1.0.0')
    await bakePresentation(backend, 'ea', '2.0.0')
    const source = new MetaModelPresentationSource(envWith(backend))
    const { iconKeys } = await source.load()
    expect(iconKeys.has('mm:application')).toBe(true)
})

// ── stable source id ──────────────────────────────────────────────────────────

test('MetaModelPresentationSource has id "meta-model"', () => {
    const backend = new FakeStorage('fake://meta-models')
    const source = new MetaModelPresentationSource(envWith(backend))
    expect(source.id).toBe('meta-model')
})
