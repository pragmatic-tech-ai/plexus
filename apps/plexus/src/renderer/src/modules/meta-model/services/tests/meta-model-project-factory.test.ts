import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'
import { META_MODELS_BACKEND_ID } from '../meta-models-backend.js'
import { loadMetaModelManifest } from '../meta-model-manifest-loader.js'

function factory(): MetaModelProjectFactory
{
    return new MetaModelProjectFactory(new ServiceProvider())
}

// A provider whose meta-models backend resolves to an inspectable FakeStorage
// (pre-registered, so ensureMetaModelsBackend's Has-check finds it).
function publishEnv(): { provider: ServiceProvider; dest: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const dest = new FakeStorage('fake://meta-models')
    registry.Register(META_MODELS_BACKEND_ID, () => dest)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    return { provider, dest }
}

// Verified-clean TODL (see the empirical probe): concepts in one file, a
// meta-model referencing them in another — check() returns zero diagnostics.
const CONCEPTS = 'namespace d { concept model { label : string; } concept component { label : string; } concept location { label : string; } }'
// A missing concept name is a syntax error.
const BAD = 'namespace d { concept { label : string; } }'
// A clean package with a declared annotation applied at package level (0.5.0).
const PKG_ANN = 'namespace d { annotation author { name : string; } package { annotate author { name = "Acme Corp"; } } concept widget { label : string; } }'

test('getVersion/setVersion round-trips modelVersion, preserving other fields', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme EA')          // seeds modelVersion '0.1.0', id 'acme-ea'
    expect(await f.getVersion(storage)).toBe('0.1.0')
    await f.setVersion(storage, '0.2.0')
    expect(await f.getVersion(storage)).toBe('0.2.0')
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.id).toBe('acme-ea')                        // untouched
})

test('createProject writes a meta-model manifest with a publish identity', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme EA')

    expect(project.Type).toBe('meta-model')
    expect(project.Name).toBe('Acme EA')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(manifest.type).toBe('meta-model')
    expect(manifest.id).toBe('acme-ea')          // slugified
    expect(manifest.modelVersion).toBe('0.1.0')
})

test('createProject writes the agent-support scaffold (CLAUDE.md + .claude/)', async () => {
    const storage = new FakeStorage('fake://Acme')
    await factory().createProject(storage, 'Acme EA')

    expect(await storage.Exists('CLAUDE.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
    expect(await storage.Exists('.claude/meta-model-guide.md')).toBe(true)
    expect(await storage.Exists('.claude/commands/new-concept.md')).toBe(true)
    // Content is the real asset, not a placeholder.
    expect(await storage.ReadText('CLAUDE.md')).toMatch(/meta-model/i)
    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)
})

test('scaffold surfaces in the tree (shown, not hidden like the manifest)', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme EA')
    const names = project.Root.Children.ToArray().map((n) => n.Name)
    expect(names).toContain('CLAUDE.md')
    expect(names).toContain('.claude')
    expect(names).not.toContain(PROJECT_MANIFEST_FILENAME)
})

test('openProject self-heals a missing scaffold without overwriting edits', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'P', id: 'p', modelVersion: '0.1.0' }))
    // Pre-existing, author-edited CLAUDE.md — must be preserved.
    await storage.WriteText('CLAUDE.md', 'MY EDITS')

    await factory().openProject(storage)

    expect(await storage.ReadText('CLAUDE.md')).toBe('MY EDITS')   // not clobbered
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)   // the missing one filled in
})

test('openProject tags .todl nodes openable and hides the manifest', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', name: 'P', id: 'p', modelVersion: '0.1.0' }))
    await storage.WriteText('defs/core.todl', CONCEPTS)
    await storage.WriteText('readme.md', 'hi')

    const project = await factory().openProject(storage)
    const names = project.Root.Children.ToArray().map((n) => n.Name)
    expect(names).toContain('defs')
    expect(names).not.toContain(PROJECT_MANIFEST_FILENAME)

    const defs = project.Root.Children.ToArray().find((n) => n.Name === 'defs')!
    expect(defs.Kind).toBe('folder')
    const core = defs.Children.ToArray()[0]
    expect(core.Kind).toBe('todl')
    expect(core.Path).toBe('defs/core.todl')
    const readme = project.Root.Children.ToArray().find((n) => n.Name === 'readme.md')!
    expect(readme.Kind).toBe('file')
})

test('publish writes compiled model + sources for a clean project', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    expect(await dest.Exists('acme/0.1.0/model.json')).toBe(true)
    const doc = JSON.parse(await dest.ReadText('acme/0.1.0/model.json'))
    expect(Array.isArray(doc.nodes)).toBe(true)
    const ids = new Set((doc.nodes as { id: string }[]).map((n) => n.id))
    // Own-only: the meta-model's own concepts are present; the prelude is not
    // copied in, and there are no dependencies (a meta-model binds nothing).
    expect(ids.has('component')).toBe(true)
    expect(ids.has('identifier')).toBe(false)
    expect(doc.dependencies).toBeUndefined()
    expect(await dest.Exists('acme/0.1.0/src/concepts.todl')).toBe(true)
})

test('publish writes a manifest.json with identity + package annotations', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('defs.todl', PKG_ANN)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    expect(await dest.Exists('acme/0.1.0/manifest.json')).toBe(true)

    const m = await loadMetaModelManifest(dest, 'acme', '0.1.0')
    expect(m.id).toBe('acme')
    expect(m.version).toBe('0.1.0')
    expect(m.name).toBe('Acme')
    expect(m.annotations).toEqual({ author: { name: 'Acme Corp' } })
    expect(m.problems).toEqual([])
})

test('publish writes a manifest with empty annotations for a package-less model', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)   // plain concepts, no package block

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    await f.publish(project, storage, provider)

    const m = await loadMetaModelManifest(dest, 'acme', '0.1.0')
    expect(m.annotations).toEqual({})
    expect(m.problems).toEqual([])
})

test('publish is blocked and writes nothing when a source has an error', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('bad.todl', BAD)

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/error/i)
    expect(dest.size).toBe(0)                           // nothing written
})

test('regeneratePresentation writes an assets dict merging author + scaffolded stubs', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)
    // an author override dictionary under presentation/
    await storage.WriteText('presentation/custom.mu', 'resources MetaModelPresentationCustom { }')

    await f.regeneratePresentation(storage, true)

    const out = await storage.ReadText('presentation.generated.mu')
    expect(out).toContain('resources MetaModelPresentation {')
    expect(out).not.toContain('DataTemplate')  // assets dict only — no per-entity templates
    expect(out).not.toContain('merge ')
    // No template scaffolding: every entity renders through Plexus's one default template.
    expect(await storage.Exists('presentation/templates.mu')).toBe(false)
})

test('regeneratePresentation is a no-op when the project has no .todl sources', async () => {
    const storage = new FakeStorage('fake://Empty')
    const f = factory()
    await f.createProject(storage, 'Empty')

    await f.regeneratePresentation(storage, true)

    expect(await storage.Exists('presentation.generated.mu')).toBe(false)
})

test('publish also (re)writes presentation.generated.mu into the project', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)

    const { provider } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    expect(await storage.Exists('presentation.generated.mu')).toBe(true)
    expect(await storage.ReadText('presentation.generated.mu')).not.toContain('merge ')
    // No template scaffolding — assets-only presentation.
    expect(await storage.Exists('presentation/templates.mu')).toBe(false)
})

test('publish ships the presentation payload into the backend', async () => {
    const storage = new FakeStorage('fake://Acme')
    const f = factory()
    await f.createProject(storage, 'Acme')
    await storage.WriteText('concepts.todl', CONCEPTS)
    // an author override dictionary under presentation/
    await storage.WriteText('presentation/custom.mu', 'resources MetaModelPresentationCustom { }')

    const { provider, dest } = publishEnv()
    const project = await f.openProject(storage)
    const result = await f.publish(project, storage, provider)

    expect(result.ok).toBe(true)
    // Compiled presentation shipped to the backend (self-contained, no raw .mu).
    expect(await dest.Exists('acme/0.1.0/presentation/presentation.compiled.json')).toBe(true)
    expect(await dest.Exists('acme/0.1.0/presentation/presentation.generated.mu')).toBe(false)
    // Result message reports the presentation counts.
    expect(result.message).toMatch(/presentation:/)
    // Existing contract intact.
    expect(await dest.Exists('acme/0.1.0/model.json')).toBe(true)
    expect(await dest.Exists('acme/0.1.0/src/concepts.todl')).toBe(true)
})
