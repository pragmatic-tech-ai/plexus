import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { DiagnosticsService } from '../../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '../../../../services/diagnostics/diagnostic.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'

// Seed is SYNCHRONOUS: FakeStorage.WriteText sets its map synchronously, so every
// file is present before discover() lists the backend (an async seed with awaits
// would race the first List). Matches the meta-models-service test pattern.
function envWith(backend: FakeStorage): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    return { provider, diagnostics }
}

function env(seed: (b: FakeStorage) => void): { provider: ServiceProvider; diagnostics: DiagnosticsService } {
    const backend = new FakeStorage('fake://libraries')
    seed(backend)
    return envWith(backend)
}

function manifest(id: string, template = `visuals/${id}.azure.mural`): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template }],
        assets: [], docs: [], samples: [],
    })
}

test('discover returns LoadedLibrary[] with id, version, name, classes and metaModel', async () => {
    const { provider } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
    })
    const reg = new LibraryRegistry(provider)
    const libs = await reg.discover()
    expect(libs).toHaveLength(1)
    expect(libs[0].id).toBe('microsoft')
    expect(libs[0].version).toBe('0.1.0')
    expect(libs[0].name).toBe('microsoft')
    expect(libs[0].classes).toHaveLength(1)
    expect(libs[0].classes[0].id).toBe('microsoft.azure')
})

test('discover returns an empty array when nothing is published', async () => {
    const { provider } = env(() => {})
    const reg = new LibraryRegistry(provider)
    const libs = await reg.discover()
    expect(libs).toEqual([])
})

test('discover publishes discovery problems for a class referencing a missing template file', async () => {
    // The manifest references a template that does not exist on disk — discoverLibraries
    // records a LoadProblem with severity "warning" for the missing asset.
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft', 'visuals/missing.mural'))
        // Template file intentionally absent.
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    const diags = [...diagnostics.All].filter((d) => d.projectId === 'library:microsoft@0.1.0')
    // At least one warning published for the missing template.
    expect(diags.some((d) => d.severity === DiagnosticSeverity.Warning)).toBe(true)
})

test('delete removes the library from the backend and clears its Problems slice', async () => {
    const { provider, diagnostics } = env((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft', 'visuals/missing.mural'))
    })
    const reg = new LibraryRegistry(provider)
    await reg.discover()
    expect([...diagnostics.All].some((d) => d.projectId === 'library:microsoft@0.1.0')).toBe(true)

    await reg.delete('microsoft', '0.1.0')

    // After delete the backend entry is gone so the next discover returns nothing.
    expect(await reg.discover()).toEqual([])
    // And the Problems slice is cleared.
    expect([...diagnostics.All].some((d) => d.projectId === 'library:microsoft@0.1.0')).toBe(false)
})

test('discover can be called multiple times and rebuilds the metadata each time', async () => {
    const backend = new FakeStorage('fake://libraries')
    void backend.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
    const { provider } = envWith(backend)
    const reg = new LibraryRegistry(provider)

    const first = await reg.discover()
    const second = await reg.discover()
    expect(first.map((l) => l.id)).toEqual(['microsoft'])
    expect(second.map((l) => l.id)).toEqual(['microsoft'])
})
