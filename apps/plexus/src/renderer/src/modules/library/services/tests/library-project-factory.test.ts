import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON } from '@pragmatic-tech-ai/todl'

import { PROJECT_MANIFEST_FILENAME } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PackageStoreKey } from '@pragmatic-tech-ai/todl'
import { Severity } from '@pragmatic-tech-ai/todl/build-system-core'
import { PACKAGES_BACKEND_ID } from '../../../../services/projects/packages-backend.js'
import { PlexusPackageStore } from '../../../../services/projects/storage-service-backends.js'
import { ComposedPackageBuild } from '../../../../services/projects/tests/composed-package-build.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

function factory(): LibraryProjectFactory { return new LibraryProjectFactory(new ServiceProvider()) }

// A meta-model with the concepts a library references, published to a fake
// meta-models backend; plus a fake libraries backend to receive the publish.
const META = 'namespace ea { concept Location { label : string; } concept Technology { label : string; } }'
function publishEnv(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage }
{
  const provider = new ServiceProvider()
  const registry = new StorageService(provider)
  // One unified packages backend: meta-model bases and the library publish target
  // share the single root (kind no longer routes storage).
  const packages = new FakeStorage('fake://packages')
  registry.Register(PACKAGES_BACKEND_ID, () => packages)
  provider.registerInstance(StorageService.Key, registry)
  provider.registerInstance(PackageStoreKey, new PlexusPackageStore(provider))
  return { provider, meta: packages, libs: packages }
}
async function seedMeta(meta: FakeStorage): Promise<void>
{
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'm.todl', text: META }]).model)))
}

const LIB = `namespace lib { import ea; taxonomy Microsoft : represents Location, Technology {
  Location Azure { label = "Azure"; }
  Technology AzureOpenai { label = "Azure OpenAI"; }
} }`

test('createProject writes the shared TODL scaffold + a library CLAUDE.md', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'Acme Lib', { metaModels: [{ id: 'ea', version: '5' }] })
  expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
  expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
  expect(await storage.Exists('CLAUDE.md')).toBe(true)
  expect(await storage.ReadText('CLAUDE.md')).toMatch(/library/i)
})

test('getVersion/setVersion round-trips packageVersion, preserving id + metaModels', async () => {
  const storage = new FakeStorage('fake://Acme')
  const f = factory()
  await f.createProject(storage, 'Acme Lib', { metaModels: [{ id: 'ea', version: '5' }] })
  expect(await f.getVersion(storage)).toBe('0.1.0')
  await f.setVersion(storage, '1.0.0')
  expect(await f.getVersion(storage)).toBe('1.0.0')
  const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(m.id).toBe('acme-lib')                        // untouched
  expect(m.metaModels).toEqual([{ id: 'ea', version: '5' }])   // untouched
})

test('createProject writes a library manifest with a publish identity + binding', async () => {
  const storage = new FakeStorage('fake://Acme')
  const project = await factory().createProject(storage, 'Acme Lib', { metaModels: [{ id: 'ea', version: '5' }] })
  expect(project.Type).toBe('library')
  const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
  expect(manifest.type).toBe('library')
  expect(manifest.id).toBe('acme-lib')
  expect(manifest.packageVersion).toBe('0.1.0')
  expect(manifest.metaModels).toEqual([{ id: 'ea', version: '5' }])
})

test('requiresMetaModel is true', () => {
  expect(factory().requiresMetaModel).toBe(true)
})

// Builds the library in `storage` with the TODL npm-package build exactly as Plexus
// composes it, resolving the bound meta-model through the app's PlexusPackageStore.
async function buildComposed(storage: FakeStorage, provider: ServiceProvider)
{
  return new ComposedPackageBuild(provider).Build(storage, new PlexusPackageStore(provider))
}

test('the composed build validates against the bound meta-model (via PlexusPackageStore) and emits the own-only library', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'microsoft', { metaModels: [{ id: 'ea', version: '5' }] })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider, meta } = publishEnv()
  await seedMeta(meta)

  const result = await buildComposed(storage, provider)
  expect(result.Ok, JSON.stringify(result.Diagnostics)).toBe(true)
  const doc = JSON.parse(await result.Output.ReadText('model.json'))
  const ids = new Set((doc.nodes as { id: string }[]).map((n) => n.id))
  // Own-only: the library's own taxonomy terms are present; the base meta-model's
  // concepts and the prelude are NOT copied in.
  expect(ids.has('lib.Microsoft.Azure')).toBe(true)
  expect(ids.has('ea.Location')).toBe(false)
  expect(ids.has('todl.identifier')).toBe(false)
  // The bound meta-model is recorded as a dependency (exact version).
  expect(doc.dependencies).toContainEqual({ kind: 'meta-model', id: 'ea', version: '5' })
})

test('the composed build fails when the bound meta-model is not published', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'microsoft', { metaModels: [{ id: 'ghost', version: '1' }] })
  await storage.WriteText('microsoft.todl', LIB)
  const { provider } = publishEnv()

  const result = await buildComposed(storage, provider)
  expect(result.Ok).toBe(false)
  expect(await result.Output.Exists('model.json')).toBe(false)   // nothing promoted
})

test('samples/*.todl is excluded from the compiled model', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'microsoft', { metaModels: [{ id: 'ea', version: '5' }] })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('samples/demo.todl', 'namespace boom { this is not valid todl }')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)

  const result = await buildComposed(storage, provider)
  // Would fail to compile if samples/ were included; it is excluded, so the build succeeds.
  expect(result.Ok, JSON.stringify(result.Diagnostics)).toBe(true)
})

// A meta-model whose `location` concept a taxonomy term can be a class of, so the
// library can declare an iconful class.
const META_ICON = 'namespace ea { concept location { label : string; } concept technology { label : string; } }'
async function seedMetaIcon(meta: FakeStorage): Promise<void>
{
  await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'm.todl', text: META_ICON }]).model)))
}

test('the composed build bakes presentation through the TODL default baker (PresentationBakerKey)', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'microsoft', { metaModels: [{ id: 'ea', version: '5' }] })
  await storage.WriteText('microsoft.todl',
    'namespace lib { import ea; taxonomy microsoft : represents location { location azure { label = "Azure"; annotate icon { path = "resources/azure.svg"; } } } }')
  await storage.WriteText('resources/azure.svg', '<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>')
  const { provider, meta } = publishEnv()
  await seedMetaIcon(meta)

  const result = await buildComposed(storage, provider)
  expect(result.Ok, JSON.stringify(result.Diagnostics)).toBe(true)
  expect(await result.Output.Exists('presentation/presentation.compiled.json')).toBe(true)
  const index = JSON.parse(await result.Output.ReadText('presentation/icon-index.json')) as Record<string, string>
  expect(Object.values(index)).toContain('mm_icon_azure')
})

test('the composed build blocks when a class references an icon with no project file (nothing promoted)', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'microsoft', { metaModels: [{ id: 'ea', version: '5' }] })
  // a class carrying an icon path, but the SVG file is never written to the project
  await storage.WriteText('microsoft.todl',
    'namespace lib { import ea; taxonomy microsoft : represents location { location azure { label = "Azure"; annotate icon { path = "resources/azure.svg"; } } } }')
  const { provider, meta } = publishEnv()
  await seedMetaIcon(meta)

  const result = await buildComposed(storage, provider)
  expect(result.Ok).toBe(false)
  expect(result.Diagnostics.some((d) => /missing icon file\(s\): resources\/azure\.svg/.test(d.message)), JSON.stringify(result.Diagnostics)).toBe(true)
  expect(await result.Output.Exists('model.json')).toBe(false)   // nothing promoted
})

test('an orphan visual is a non-blocking warning', async () => {
  const storage = new FakeStorage('fake://Acme')
  await factory().createProject(storage, 'microsoft', { metaModels: [{ id: 'ea', version: '5' }] })
  await storage.WriteText('microsoft.todl', LIB)
  await storage.WriteText('visuals/ghost.mural', '<template/>')
  const { provider, meta } = publishEnv()
  await seedMeta(meta)

  const result = await buildComposed(storage, provider)
  expect(result.Ok, JSON.stringify(result.Diagnostics)).toBe(true)
  expect(result.Diagnostics.some((d) => d.severity === Severity.Warning && /ghost/.test(d.message))).toBe(true)
})
