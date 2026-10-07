import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, type IDocument, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft, ProjectNode, ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Project } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project.js'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { FakeSolutionManager } from '../../../../services/solution/tests/fake-solution-manager.js'
import { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'

// Regression guard for the "default icons until the Tool Box is opened" bug: the
// always-live binding service must bake the presentation registry on attach, through
// the shared Refresh() API — independently of the toolbox. (Bootstrapping the
// registry's sources + the GraphChanged re-bake lives in TodlPresentationRegistry
// itself; see todl-presentation-registry.test.ts.)

const MM = `namespace archmm {
  concept Component {}
  viewpoint ComponentView : frames Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }

// A stand-in registry that records Refresh() calls; onChanged is a no-op the binding's
// own icon reactivity subscribes to.
class SpyRegistry
{
    public refreshCount = 0
    public async Refresh(): Promise<void> { this.refreshCount++ }
    public onChanged(_cb: (key: string) => void): () => void { return () => {} }
    public iconKeyFor(_entityKey: string): string | undefined { return undefined }
}

function buildModel(storage: FakeStorage): ArchModel
{
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc))], [fileA], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

function diagramFor(projStorage: FakeStorage): DiagramDocument
{
    const store = new FileDiagramStorage('view.diagram', projStorage, null)
    return new DiagramDocument(store)
}

function wire(projStorage: FakeStorage, model: ArchModel): { provider: ServiceProvider; open: ObservableCollection<IDocument>; registry: SpyRegistry }
{
    const open = new ObservableCollection<IDocument>()
    const host = { OpenDocuments: open } as unknown as DocumentsContentHostService
    const project = new Project('architecture', 'Acme', projStorage.Root, new ProjectNode('Acme', '', ProjectNodeKind.Folder))
    const manager = new FakeSolutionManager()
    manager.AddResolved(project, projStorage)

    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    manager.RegisterOn(provider)
    provider.registerInstance(ArchitectureModelService.Key, { modelFor: async () => model } as unknown as ArchitectureModelService)
    const registry = new SpyRegistry()
    provider.registerInstance(TodlPresentationRegistry.Key, registry as unknown as TodlPresentationRegistry)
    return { provider, open, registry }
}

test('attaching an architecture diagram refreshes the presentation registry (no Tool Box needed)', async () => {
    const projStorage = new FakeStorage('fake://Acme')
    const model = buildModel(projStorage)
    const { provider, open, registry } = wire(projStorage, model)
    const service = new ArchDiagramBindingService(provider)

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await service.ensureBound(doc)   // deterministically await the attach

    expect(registry.refreshCount).toBeGreaterThanOrEqual(1)
})
