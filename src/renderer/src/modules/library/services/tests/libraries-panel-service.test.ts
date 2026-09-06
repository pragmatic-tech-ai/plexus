import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '../../../../services/storage/tests/fake-storage.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryRegistry } from '../library-registry.js'
import { LibrariesPanelService } from '../libraries-panel-service.js'
import { LibraryNodeKind, LibraryTreeNode } from '../library-tree-node.js'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

// Synchronous seed (see the registry test) so all files exist before Reload lists.
function providerWith(seed: (b: FakeStorage) => void): ServiceProvider {
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    registry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    provider.registerInstance(LibraryRegistry.Key, new LibraryRegistry(provider))
    seed(backend)
    return provider
}

function leaves(root: LibraryTreeNode): LibraryTreeNode[] {
    const out: LibraryTreeNode[] = []
    for (const concept of root.Children.ToArray())
        for (const cls of concept.Children.ToArray()) out.push(cls)
    return out
}

test('builds a Library -> Concept -> Class tree, concepts sorted, leaves carry term + template', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'Microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [
                { id: 'Microsoft.Azure', localId: 'azure', label: 'Azure', concept: 'location', template: 'visuals/a.mural' },
                { id: 'Stack.AzureOpenai', localId: 'AzureOpenai', label: 'Azure OpenAI', concept: 'technology', template: 'visuals/b.mural' },
            ],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('microsoft/0.1.0/visuals/a.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('microsoft/0.1.0/visuals/b.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    expect(svc.IsEmpty).toBe(false)
    expect(svc.Roots.Count).toBe(1)
    const lib = svc.Roots.Get(0)!
    expect(lib.Kind).toBe(LibraryNodeKind.Library)
    expect(lib.Name).toContain('Microsoft')
    expect(lib.Children.ToArray().map((c) => c.Name)).toEqual(['location', 'technology'])   // sorted

    const tech = lib.Children.ToArray().find((c) => c.Name === 'technology')!
    expect(tech.Kind).toBe(LibraryNodeKind.Concept)
    expect(tech.Children.Count).toBe(1)
    const leaf = tech.Children.Get(0)!
    expect(leaf.Kind).toBe(LibraryNodeKind.Class)
    expect(leaf.TermId).toBe('Stack.AzureOpenai')
    expect(leaf.Concept).toBe('technology')
    expect(leaf.IsDraggable).toBe(true)
    // Leaves carry a library-class descriptor keyed on the term; the visual resolves
    // (and lazily compiles) through the shared presenter on preview/canvas.
    expect(leaf.Descriptor?.ResolverKey).toBe(TodlVisualResolverKey)
    expect(leaf.Descriptor?.Key).toBe('Stack.AzureOpenai')
})

test('IsLoading is true while discovering and false once the tree is built', async () => {
    const svc = new LibrariesPanelService(providerWith((b) => {
        void b.WriteText('ms/0.1.0/library.json', JSON.stringify({
            id: 'ms', version: '0.1.0', name: 'MS', metaModel: { id: 'ea', version: '5' },
            classes: [{ id: 'stack.a', localId: 'a', label: 'A', concept: 'technology', template: 'visuals/a.mural' }],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('ms/0.1.0/visuals/a.mural', 'TextBlock [ Text = $Display ]')
    }))
    const p = svc.Reload()
    expect(svc.IsLoading).toBe(true)     // set synchronously before the discover await
    await p
    expect(svc.IsLoading).toBe(false)
})

test('selecting a class drives the bottom preview pane; selecting another moves it; a group clears it', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('ms/0.1.0/library.json', JSON.stringify({
            id: 'ms', version: '0.1.0', name: 'MS', metaModel: { id: 'ea', version: '5' },
            classes: [
                { id: 'stack.a', localId: 'a', label: 'A', concept: 'technology', template: 'visuals/a.mural' },
                { id: 'stack.b', localId: 'b', label: 'B', concept: 'technology', template: 'visuals/b.mural' },
            ],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('ms/0.1.0/visuals/a.mural', 'TextBlock [ Text = $Display ]')
        void b.WriteText('ms/0.1.0/visuals/b.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    const lib = svc.Roots.Get(0)!
    const [a, b] = leaves(lib)

    svc.SelectedNode = a
    expect(svc.HasPreview).toBe(true)
    expect(svc.PreviewData).toBe(a)
    expect(a.Concept).toBe('technology')
    expect(a.Descriptor?.Key).toBe('stack.a')   // node carries its own visual descriptor

    svc.SelectedNode = b
    expect(svc.PreviewData).toBe(b)
    expect(b.Descriptor?.Key).toBe('stack.b')   // the newly-selected node has its own too

    svc.SelectedNode = lib          // a group node clears the preview
    expect(svc.HasPreview).toBe(false)
    expect(svc.PreviewData).toBeUndefined()
})

test('IsEmpty is true when nothing is published', async () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    await svc.Reload()
    expect(svc.IsEmpty).toBe(true)
    expect(svc.Roots.Count).toBe(0)
})

test('Reload() calls TodlPresentationRegistry.discover() when storage is wired', async () => {
    const provider = new ServiceProvider()
    const storageRegistry = new StorageProviderRegistry(provider)
    const backend = new FakeStorage('fake://libraries')
    storageRegistry.Register(LIBRARIES_BACKEND_ID, () => backend)
    provider.registerInstance(StorageProviderRegistry.Key, storageRegistry)
    provider.registerInstance(LibraryRegistry.Key, new LibraryRegistry(provider))

    let discoverCalled = false
    const fakeRegistry = {
        registerSource: () => {},   // absorb idempotent registerSource calls from registerArchToolboxAdapters
        discover: async () => { discoverCalled = true },
    }
    // Pre-register the fake BEFORE LibrariesPanelService is constructed so
    // registerArchToolboxAdapters (get-or-create) leaves it in place.
    provider.registerInstance(TodlPresentationRegistry.Key, fakeRegistry as unknown as TodlPresentationRegistry)

    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    expect(discoverCalled).toBe(true)
})

test('onLibrariesChanged notifies subscribers after Reload completes, and unsubscribes', async () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    await svc.Reload()                 // settle the constructor's reload first
    let fired = 0
    const off = svc.onLibrariesChanged(() => { fired++ })
    await svc.Reload()
    expect(fired).toBe(1)
    off()
    await svc.Reload()
    expect(fired).toBe(1)
})

test('a Library node carries a Delete command that uninstalls it; Concept/Class nodes do not', async () => {
    const provider = providerWith((b) => {
        void b.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
            id: 'microsoft', version: '0.1.0', name: 'Microsoft', metaModel: { id: 'ea', version: '5' },
            classes: [{ id: 'Microsoft.Azure', localId: 'azure', label: 'Azure', concept: 'location', template: 'visuals/a.mural' }],
            assets: [], docs: [], samples: [],
        }))
        void b.WriteText('microsoft/0.1.0/visuals/a.mural', 'TextBlock [ Text = $Display ]')
    })
    const svc = new LibrariesPanelService(provider)
    await svc.Reload()

    const lib = svc.Roots.Get(0)!
    expect(lib.Kind).toBe(LibraryNodeKind.Library)
    expect(lib.LibId).toBe('microsoft')
    expect(lib.LibVersion).toBe('0.1.0')
    // Concept / Class rows get no uninstall command.
    const concept = lib.Children.Get(0)!
    expect(concept.DeleteCommand).toBeUndefined()
    expect(concept.Children.Get(0)!.DeleteCommand).toBeUndefined()

    // The Library node's command uninstalls via the registry (no DialogService in
    // this headless provider, so the confirm is skipped). deleteLibrary calls
    // registry.delete synchronously before its first await, so we can assert now.
    const registry = provider.getRequired(LibraryRegistry.Key)
    let deleted: { id: string; version: string } | undefined
    ;(registry as unknown as { delete: (id: string, v: string) => Promise<void> }).delete =
        (id, version) => { deleted = { id, version }; return Promise.resolve() }
    expect(lib.DeleteCommand).toBeDefined()
    lib.DeleteCommand!.Execute()
    expect(deleted).toEqual({ id: 'microsoft', version: '0.1.0' })
})

// ── RevealTerm ─────────────────────────────────────────────────────────────
// Seed a library > concept > leaf(term) tree directly, then reveal by term id.
function seedTree(svc: LibrariesPanelService, termId: string): { lib: LibraryTreeNode; grp: LibraryTreeNode; leaf: LibraryTreeNode } {
    svc.Roots.Clear()
    const lib = LibraryTreeNode.library('Tech · 1.0', 'tech', '1.0')
    const grp = LibraryTreeNode.group('technology', LibraryNodeKind.Concept)
    const leaf = LibraryTreeNode.leaf({ display: '.NET', label: '.NET', localId: 'dotnet', termId, concept: 'technology' })
    grp.Children.Add(leaf); lib.Children.Add(grp); svc.Roots.Add(lib)
    return { lib, grp, leaf }
}

test('RevealTerm expands ancestors and selects the matching leaf', () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    const { lib, grp, leaf } = seedTree(svc, 'tech.dotnet')
    const ok = svc.RevealTerm('tech.dotnet')
    expect(ok).toBe(true)
    expect(lib.IsExpanded).toBe(true)
    expect(grp.IsExpanded).toBe(true)
    expect(leaf.IsExpanded).toBe(false) // leaf is selected, not expanded
    expect(svc.SelectedNode).toBe(leaf)
})

test('RevealTerm returns false and does not select when the term is absent', () => {
    const svc = new LibrariesPanelService(providerWith(() => {}))
    seedTree(svc, 'tech.dotnet')
    const ok = svc.RevealTerm('nope')
    expect(ok).toBe(false)
    expect(svc.SelectedNode).toBeUndefined()
})
