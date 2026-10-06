import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { FakeSolutionManager } from '../../../../services/solution/tests/fake-solution-manager.js'
import { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { ToolboxService } from '../diagram-panel-services.js'
import { ArchToolboxVisualKey } from '../arch-toolbox-item.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PACKAGES_BACKEND_ID } from '../../../../services/projects/packages-backend.js'

const MODEL = JSON.stringify({
  nodes: [
    { id: 'actors', tier: 'Ontology', metaKind: 'taxonomy', attrs: { label: 'Actors' } },
    { id: 'actors@todl.toolbox', tier: 'Ontology', type: 'todl.toolbox', attrs: { visible: true } },
    { id: 'actors.internal', tier: 'Instance', type: 'actor', metaKind: 'term', isClass: true, attrs: { label: 'Internal' } },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'actors', to: 'actors@todl.toolbox' },
    { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
  ],
})

// A second taxonomy from a different published package, so context filtering can hide it.
const MODEL2 = JSON.stringify({
  nodes: [
    { id: 'services', tier: 'Ontology', metaKind: 'taxonomy', attrs: { label: 'Services' } },
    { id: 'services@todl.toolbox', tier: 'Ontology', type: 'todl.toolbox', attrs: { visible: true } },
    { id: 'services.web', tier: 'Instance', type: 'service', metaKind: 'term', isClass: true, attrs: { label: 'Web' } },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'services', to: 'services@todl.toolbox' },
    { kind: 'Contains', via: null, from: 'services', to: 'services.web' },
  ],
})

// Inject a fake active document (its ToolboxContexts drives page visibility) and
// skip arch-project enumeration — these tests exercise the published-taxonomy path.
class TestToolbox extends ToolboxService
{
  public active: unknown = undefined
  protected activeDoc(): unknown { return this.active }
  public archScans = 0
  protected async openArchModels(): Promise<Array<{ model: never; namespace: string }>> { this.archScans++; return [] }
}

// A meta-model / library seeder over the SINGLE packages backend: each writes the
// package's model.json plus the unified bundle.json whose `type` the enumerate-by-
// kind paths filter on ('meta-model' vs 'library').
interface KindSeeder { WriteText(path: string, text: string): void }

function metaSeeder(backend: FakeStorage): KindSeeder
{
  return {
    WriteText(path, text)
    {
      void backend.WriteText(path, text)
      const base = path.slice(0, path.lastIndexOf('/'))
      void backend.WriteText(`${base}/bundle.json`, JSON.stringify({ type: 'meta-model' }))
    },
  }
}

function librarySeeder(backend: FakeStorage): KindSeeder
{
  return {
    WriteText(path, text)
    {
      void backend.WriteText(path, text)
      const base = path.slice(0, path.lastIndexOf('/'))   // `<id>/<version>`
      const [id, version] = base.split('/')
      // discoverLibraries reads id/version from bundle.json, so give it real ones.
      void backend.WriteText(`${base}/bundle.json`, JSON.stringify({ type: 'library', id, version, name: id, metaModels: [{ id: 'ea', version: '5' }], classes: [] }))
    },
  }
}

function provider(seed: (mm: KindSeeder, lib: KindSeeder) => void): ServiceProvider
{
  const p = new ServiceProvider()
  new FakeSolutionManager().RegisterOn(p)
  const reg = new StorageService(p)
  const packages = new FakeStorage('fake://packages')
  reg.Register(PACKAGES_BACKEND_ID, () => packages)
  p.registerInstance(StorageService.Key, reg)
  seed(metaSeeder(packages), librarySeeder(packages))
  return p
}

const pageIds = (svc: ToolboxService): string[] => svc.Pages.ToArray().map((p) => p.Id)
const page = (svc: ToolboxService, id: string) => svc.Pages.ToArray().find((p) => p.Id === id)

describe('ToolboxService', () => {
  it('re-syncs its page set when a solution member is added', async () => {
    const p = provider(() => {})
    const svc = new TestToolbox(p)
    await new Promise((r) => setTimeout(r, 0))
    const before = svc.archScans
    ;(p.get(SolutionManagerService.Key) as unknown as FakeSolutionManager).AddResolved({ RootPath: '/a', Name: 'A' })
    await new Promise((r) => setTimeout(r, 0))
    expect(svc.archScans).toBeGreaterThan(before)
  })

  it('keeps mural Shapes and adds a page per visible taxonomy, keyed on the term', async () => {
    const svc = new TestToolbox(provider((mm) => { void mm.WriteText('tech/0.1.0/model.json', MODEL) }))
    await svc.syncPageSet()
    expect(svc.Repository).toBeInstanceOf(ToolboxRepository)
    expect(svc.Pages).toBe(svc.Repository.Pages)
    expect(pageIds(svc)).toContain('shapes')
    const actors = page(svc, 'tax:actors')!
    expect(actors.Title).toBe('Actors')
    expect(actors.Items.Count).toBe(1)
    const item = actors.Items.ToArray()[0]
    expect(item.Id).toBe('term:actors.internal')
    expect((item.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(ArchToolboxVisualKey)
    expect(item.FactoryKey).toBe(ArchInstanceDropFactoryKey)
  })

  it('a taxonomy carried by both a meta-model and a library merges into one page, deduped by term', async () => {
    const svc = new TestToolbox(provider((mm, lib) => {
      void mm.WriteText('tech/0.1.0/model.json', MODEL)
      void lib.WriteText('ms/0.1.0/model.json', MODEL)
    }))
    await svc.syncPageSet()
    expect(svc.Pages.ToArray().filter((p) => p.Id === 'tax:actors').length).toBe(1)
    expect(page(svc, 'tax:actors')!.Items.Count).toBe(1)   // reconcile-by-key dedups the shared term
  })

  it('context filtering: both taxonomy pages exist; only the active document\'s referenced source is visible', async () => {
    const svc = new TestToolbox(provider((mm, lib) => {
      void mm.WriteText('tech/0.1.0/model.json', MODEL)     // taxonomy 'actors', source tech@0.1.0
      void lib.WriteText('acme/0.1.0/model.json', MODEL2)   // taxonomy 'services', source acme@0.1.0
    }))
    await svc.syncPageSet()
    expect(page(svc, 'tax:actors')).toBeTruthy()
    expect(page(svc, 'tax:services')).toBeTruthy()
    // No active document → empty context → content pages hidden, static pages shown.
    expect(page(svc, 'tax:actors')!.IsVisible).toBe(false)
    expect(page(svc, 'shapes')!.IsVisible).toBe(true)

    // Activate a document that references only tech@0.1.0.
    const items: string[] = []
    page(svc, 'tax:actors')!.Items.Subscribe((e) => items.push(e.kind))
    svc.active = { ToolboxContexts: new Set(['tech@0.1.0']) }
    svc.applyContexts()
    expect(page(svc, 'tax:actors')!.IsVisible).toBe(true)
    expect(page(svc, 'tax:services')!.IsVisible).toBe(false)   // acme not referenced → hidden
    expect(items).toEqual([])                                  // visibility flip does not touch items
  })

  it('empty backends → the mural default pages (Shapes + annotate)', async () => {
    const svc = new TestToolbox(provider(() => {}))
    await svc.syncPageSet()
    expect(pageIds(svc)).toEqual(['shapes', 'annotate'])
  })
})
