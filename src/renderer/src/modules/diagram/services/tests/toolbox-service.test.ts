import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ToolboxRepository, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ToolboxService } from '../diagram-panel-services.js'
import { TodlVisualResolverKey } from '../todl-visual-resolver.js'
import { ArchInstanceDropFactoryKey } from '../../../architecture-projects/services/arch-instance-drop-factory.js'
import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { META_MODELS_BACKEND_ID } from '../../../meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../library/services/libraries-backend.js'

const MODEL = JSON.stringify({
  nodes: [
    { id: 'actors', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Actors' } },
    { id: 'actors@toolbox', tier: 'Ontology', typeOf: 'toolbox', attrs: { visible: true } },
    { id: 'actors.internal', tier: 'Instance', typeOf: 'actor', attrs: { class: true, label: 'Internal' }, instanceOf: 'actor' },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'actors', to: 'actors@toolbox' },
    { kind: 'Contains', via: null, from: 'actors', to: 'actors.internal' },
  ],
})

// A second taxonomy from a different published package, so context filtering can hide it.
const MODEL2 = JSON.stringify({
  nodes: [
    { id: 'services', tier: 'Ontology', typeOf: 'taxonomy', attrs: { label: 'Services' } },
    { id: 'services@toolbox', tier: 'Ontology', typeOf: 'toolbox', attrs: { visible: true } },
    { id: 'services.web', tier: 'Instance', typeOf: 'service', attrs: { class: true, label: 'Web' }, instanceOf: 'service' },
  ],
  edges: [
    { kind: 'Annotated', via: null, from: 'services', to: 'services@toolbox' },
    { kind: 'Contains', via: null, from: 'services', to: 'services.web' },
  ],
})

// Inject a fake active document (its ToolboxContexts drives page visibility) and
// skip arch-project enumeration — these tests exercise the published-taxonomy path.
class TestToolbox extends ToolboxService {
  public active: unknown = undefined
  protected activeDoc(): unknown { return this.active }
  protected async openArchModels(): Promise<Array<{ model: never; namespace: string }>> { return [] }
}

function provider(seed: (mm: FakeStorage, lib: FakeStorage) => void): ServiceProvider {
  const p = new ServiceProvider()
  const reg = new StorageProviderRegistry(p)
  const mm = new FakeStorage('fake://meta-models'); const lib = new FakeStorage('fake://libraries')
  reg.Register(META_MODELS_BACKEND_ID, () => mm)
  reg.Register(LIBRARIES_BACKEND_ID, () => lib)
  p.registerInstance(StorageProviderRegistry.Key, reg)
  seed(mm, lib)
  return p
}

const pageIds = (svc: ToolboxService): string[] => svc.Pages.ToArray().map((p) => p.Id)
const page = (svc: ToolboxService, id: string) => svc.Pages.ToArray().find((p) => p.Id === id)

describe('ToolboxService', () => {
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
    expect((item.Descriptor as ToolboxVisualDescriptor).ResolverKey).toBe(TodlVisualResolverKey)
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
