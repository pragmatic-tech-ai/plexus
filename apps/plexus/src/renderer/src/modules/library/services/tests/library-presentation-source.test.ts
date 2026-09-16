import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { discoverLibraries } from '../library-loader.js'
import { LibraryPresentationSource } from '../library-presentation-source.js'
import { ensureLibrariesBackend } from '../libraries-backend.js'

// Wire a provider around a pre-populated backend.
function envWith(backend: FakeStorage): ServiceProvider {
    const provider = new ServiceProvider()
    const storageRegistry = new StorageProviderRegistry(provider)
    storageRegistry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, storageRegistry)
    return provider
}

const SVG = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>'

function iconManifest(icon?: string): string {
    const cls: Record<string, unknown> = { id: 'microsoft.azure', localId: 'azure', label: 'Azure', concept: 'location' }
    if (icon !== undefined) cls.icon = icon
    return JSON.stringify({ id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' }, classes: [cls], assets: [], docs: [], samples: [] })
}

// Bake a presentation artifact (assets + icon-index) into the backend for one
// iconful class, plus the library.json so discoverLibraries lists it.
async function bakeLibrary(backend: FakeStorage, withIcon = true): Promise<void> {
    const proj = new FakeStorage('fake://proj')
    if (withIcon) void proj.WriteText('resources/azure.svg', SVG)
    const doc = withIcon
        ? { nodes: [
            { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'azure', label: 'Azure' } },
            { id: 'microsoft.azure@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/azure.svg' } },
          ], edges: [{ kind: 'Annotated', via: null, from: 'microsoft.azure', to: 'microsoft.azure@icon' }] } as any
        : { nodes: [
            { id: 'microsoft.azure', tier: 'Instance', typeOf: 'location', attrs: { class: true, id: 'azure', label: 'Azure' } },
          ], edges: [] } as any
    const { publishLibraryPresentation } = await import('../library-presentation-publisher.js')
    await publishLibraryPresentation(proj, backend, 'microsoft/0.1.0', doc)
    void backend.WriteText('microsoft/0.1.0/library.json', iconManifest(withIcon ? 'resources/azure.svg' : undefined))
}

function makeSource(provider: ServiceProvider): LibraryPresentationSource {
    const backend = ensureLibrariesBackend(provider)
    return new LibraryPresentationSource(provider, async () => discoverLibraries(backend))
}

test('load() contributes the baked icon asset + a class-id icon-key index', async () => {
    const backend = new FakeStorage('fake://libraries')
    await bakeLibrary(backend)
    const source = makeSource(envWith(backend))
    const { assets, iconKeys } = await source.load()
    expect(assets.CanResolve('mm_icon_azure')).toBe(true)
    expect(iconKeys.get('microsoft.azure')).toBe('mm_icon_azure')
})

test('an icon-less class contributes no icon-key entry (falls to the default glyph)', async () => {
    const backend = new FakeStorage('fake://libraries')
    await bakeLibrary(backend, false)
    const source = makeSource(envWith(backend))
    const { iconKeys } = await source.load()
    expect(iconKeys.has('microsoft.azure')).toBe(false)
})

test('empty backend yields an empty contribution', async () => {
    const backend = new FakeStorage('fake://libraries')
    const source = makeSource(envWith(backend))
    const { iconKeys } = await source.load()
    expect(iconKeys.size).toBe(0)
})

test('LibraryPresentationSource has id "library"', () => {
    const backend = new FakeStorage('fake://libraries')
    const source = makeSource(envWith(backend))
    expect(source.id).toBe('library')
})
