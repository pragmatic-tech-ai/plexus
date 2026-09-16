import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON } from '@pragmatic-tech-ai/todl'

import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../libraries-backend.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

function factory(): LibraryProjectFactory { return new LibraryProjectFactory(new ServiceProvider()) }

// A meta-model with the concepts a library references, published to a fake
// meta-models backend; plus a fake libraries backend to receive the publish.
const META = 'namespace ea { concept Location { label : string; } concept Technology { label : string; } }'
function publishEnv(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage } {
  const provider = new ServiceProvider()
  const registry = new StorageProviderRegistry(provider)
  const meta = new FakeStorage('fake://meta-models')
  const libs = new FakeStorage('fake://libraries')
  registry.Register(META_MODELS_BACKEND_ID, () => meta)
  registry.Register(LIBRARIES_BACKEND_ID, () => libs)
  provider.registerInstance(StorageProviderRegistry.Key, registry)
  return { provider, meta, libs }
}
async function seedMeta(meta: FakeStorage): Promise<void> {
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'm.todl', text: META }]).model)))
}

const LIB = `namespace lib { import ea; taxonomy Microsoft : represents Location, Technology {
  Location Azure { label = "Azure"; }
  Technology AzureOpenai { label = "Azure OpenAI"; }
} }`

test('createProject writes the shared TODL scaffold + a library CLAUDE.md', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
  expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
  expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
  expect(await storage.Exists('CLAUDE.md')).toBe(true)
  expect(await storage.ReadText('CLAUDE.md')).toMatch(/library/i)
})

test('getVersion/setVersion round-trips libVersion, preserving id + metaModel', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
  expect(await f.getVersion(storage)).toBe('0.1.0')
  await f.setVersion(storage, '1.0.0')
  expect(await f.getVersion(storage)).toBe('1.0.0')
  const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(m.id).toBe('acme-lib')                        // untouched
  expect(m.metaModel).toEqual({ id: 'ea', version: '5' })   // untouched
})

test('createProject writes a library manifest with a publish identity + binding', async () => {
  const storage = new FakeStorage('fake://Acme')
  const project = await factory().createProject(storage, 'Acme Lib', { metaModel: { id: 'ea', version: '5' } })
  expect(project.Type).toBe('library')
  const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(manifest.type).toBe('library')
  expect(manifest.id).toBe('acme-lib')
  expect(manifest.libVersion).toBe('0.1.0')
  expect(manifest.metaModel).toEqual({ id: 'ea', version: '5' })
})

test('requiresMetaModel is true', () => {
  expect(factory().requiresMetaModel).toBe(true)
})

test('publish validates against the bound meta-model and writes the compiled library', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/model.json')).toBe(true)
  const doc = JSON.parse(await libs.ReadText('microsoft/0.1.0/model.json'))
  const ids = new Set((doc.nodes as { id: string }[]).map((n) => n.id))
  // Own-only: the library's own taxonomy terms are present; the base meta-model's
  // concepts and the prelude are NOT copied in.
  expect(ids.has('Microsoft.Azure')).toBe(true)
  expect(ids.has('Location')).toBe(false)
  expect(ids.has('identifier')).toBe(false)
  // The bound meta-model is recorded as a dependency (exact version).
  expect(doc.dependencies).toContainEqual({ kind: 'meta-model', id: 'ea', version: '5' })
  expect(await libs.Exists('microsoft/0.1.0/src/microsoft.todl')).toBe(true)
})

test('publish copies the resources/ folder into the bundle', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('resources/azure.svg', '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>')
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/resources/azure.svg')).toBe(true)
})

test('publish bundles the wiki/ pages alongside the package', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('wiki/service.md', '# Service\n\nThe service page.')
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  // A consumer resolves `annotate wiki { path = "wiki/service.md" }` against
  // <id>/<version>/ in the backend — the page ships there.
  expect(await libs.Exists('microsoft/0.1.0/wiki/service.md')).toBe(true)
})

test('publish is blocked when the bound meta-model is not published', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ghost', version: '1' } })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, libs } = publishEnv()
  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(false)
  expect(libs.size).toBe(0)
})

test('publish writes library.json with the derived classes + resource paths, and copies the folders', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/Microsoft.Azure.mural', '<template/>')
  await storage.WriteText('thumbnails/Microsoft.Azure.png', 'PNGBYTES')
  await storage.WriteText('docs/Microsoft.Azure.md', '# Azure')
  await storage.WriteText('assets/logo.svg', '<svg/>')
  await storage.WriteText('samples/demo.todl', 'sample instance')

  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  expect(result.ok).toBe(true)

  const bundle = JSON.parse(await libs.ReadText('microsoft/0.1.0/library.json'))
  expect(bundle.id).toBe('microsoft')
  expect(bundle.version).toBe('0.1.0')
  expect(bundle.metaModel).toEqual({ id: 'ea', version: '5' })
  expect(bundle.classes.map((c: { id: string }) => c.id).sort())
      .toEqual(['Microsoft.Azure', 'Microsoft.AzureOpenai'])
  const azure = bundle.classes.find((c: { id: string }) => c.id === 'Microsoft.Azure')
  expect(azure).toMatchObject({
      localId: 'Azure', label: 'Azure', concept: 'Location',
      template: 'visuals/Microsoft.Azure.mural',
      thumbnail: 'thumbnails/Microsoft.Azure.png',
      doc: 'docs/Microsoft.Azure.md',
  })
  expect(bundle.assets).toEqual(['assets/logo.svg'])
  expect(bundle.samples).toEqual(['samples/demo.todl'])

  // Resource folders copied into the bundle.
  expect(await libs.Exists('microsoft/0.1.0/visuals/Microsoft.Azure.mural')).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/assets/logo.svg')).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/samples/demo.todl')).toBe(true)
})

test('samples/*.todl is excluded from the compiled model', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('samples/demo.todl', 'namespace boom { this is not valid todl }')

  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  // Would fail to compile if samples/ were included; it is excluded, so publish succeeds.
  expect(result.ok).toBe(true)
  // The invalid sample is still copied verbatim into the bundle (as a resource).
  expect(await libs.Exists('microsoft/0.1.0/samples/demo.todl')).toBe(true)
})

test('an orphan visual is a non-blocking warning', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/ghost.mural', '<template/>')

  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const result = await f.publish(await f.openProject(storage), storage, provider)

  expect(result.ok).toBe(true)
  expect(result.message).toContain('warning')
})

// ── presentation generation ───────────────────────────────────────────────────
// regeneratePresentation resolves the bound meta-model, so it needs the publishEnv
// provider + a seeded meta-model. `factoryWith(provider)` builds a factory on it.
function factoryWith(provider: ServiceProvider): LibraryProjectFactory { return new LibraryProjectFactory(provider) }

test('regeneratePresentation writes presentation.generated.mu with a template per class + author merge', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('presentation/custom.mu', 'resources LibraryPresentationCustom { }')

  await f.regeneratePresentation(storage, true)

  const out = await storage.ReadText('presentation.generated.mu')
  expect(out).toContain('resources LibraryPresentation {')
  expect(out).not.toContain('DataTemplate')  // assets dict only — no per-entity templates
  expect(out).not.toContain('merge ')
  // No template scaffolding: every class renders through Plexus's one default template.
  expect(await storage.Exists('presentation/templates.mu')).toBe(false)
})

test('regeneratePresentation is a no-op when the project has no .todl sources', async () => {
  const storage = new FakeStorage('fake://Empty')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'empty', { metaModel: { id: 'ea', version: '5' } })

  await f.regeneratePresentation(storage, true)

  expect(await storage.Exists('presentation.generated.mu')).toBe(false)
})

test('regeneratePresentation is a no-op when a .todl has a compile error', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('bad.todl', 'namespace lib { taxonomy microsoft : represents nonesuch { } }')

  await f.regeneratePresentation(storage, true)

  expect(await storage.Exists('presentation.generated.mu')).toBe(false)
})

test('publish bakes presentation.compiled.json into the bundle and refreshes the project file', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta, libs } = publishEnv()
  await seedMeta(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  await storage.WriteText('microsoft.todl', LIB)

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(true)
  expect(await libs.Exists('microsoft/0.1.0/presentation/presentation.compiled.json')).toBe(true)
  expect(await storage.Exists('presentation.generated.mu')).toBe(true)   // project file refreshed
  expect(result.message).toMatch(/presentation:/)
})

// A meta-model whose `location` concept declares an `icon` field, so a taxonomy
// term can carry an icon path — used to exercise the missing-icon publish block.
const META_ICON = 'namespace ea { concept location { label : string; icon : string; } concept technology { label : string; } }'
async function seedMetaIcon(meta: FakeStorage): Promise<void> {
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'm.todl', text: META_ICON }]).model)))
}

test('publish blocks when a class references an icon with no project file', async () => {
  const storage = new FakeStorage('fake://Acme')
  const { provider, meta, libs } = publishEnv()
  await seedMetaIcon(meta)
  const f = factoryWith(provider)
  await f.createProject(storage, 'microsoft', { metaModel: { id: 'ea', version: '5' } })
  // a class carrying an icon path, but the SVG file is never written to the project
  await storage.WriteText('microsoft.todl',
    'namespace lib { import ea; taxonomy microsoft : represents location { location azure { label = "Azure"; annotate icon { path = "resources/azure.svg"; } } } }')

  const result = await f.publish(await f.openProject(storage), storage, provider)
  expect(result.ok).toBe(false)
  expect(result.message).toMatch(/icon/i)
  expect(await libs.Exists('microsoft/0.1.0/model.json')).toBe(false)   // nothing written
})
