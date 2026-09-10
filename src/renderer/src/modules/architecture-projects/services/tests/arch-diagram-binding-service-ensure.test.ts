import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, type IDocument, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'

const MM = `namespace archmm {
  concept Component {}
  viewpoint ComponentView : frames Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }

function buildModel(storage: FakeStorage): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc))], [fileA], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

function diagramFor(projStorage: FakeStorage): DiagramDocument {
    const store = new FileDiagramStorage('view.diagram', projStorage, null)
    return new DiagramDocument(store)
}

// This mirrors the real app's open sequence: DocumentsContentHostService.Open()
// fires OpenDocuments.Add FIRST (→ the binding service's sync starts an attach and
// awaits the model load), then sets ActiveDocument (→ the toolbox contributor calls
// ensureBound). `modelFor` is gated so the first attach is still in flight when
// ensureBound is called — reproducing the first-open race.
function wireGated(projStorage: FakeStorage, model: ArchModel): { provider: ServiceProvider; open: ObservableCollection<IDocument>; release: () => void } {
    const open = new ObservableCollection<IDocument>()
    const host = { OpenDocuments: open } as unknown as DocumentsContentHostService
    const project = new Project('architecture', 'Acme', projStorage.Root, new ProjectNode('Acme', '', 'folder'))
    const op = { Project: project, Storage: projStorage } as unknown as OpenProject
    const explorer = { OpenProjects: new ObservableCollection<OpenProject>([op]) } as unknown as ProjectExplorerService

    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const modelSvc = { modelFor: async () => { await gate; return model } } as unknown as ArchitectureModelService

    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    provider.registerInstance(ArchitectureModelService.Key, modelSvc)
    return { provider, open, release }
}

const microtasks = () => Promise.resolve().then(() => undefined)

test('ensureBound resolves only after a concurrent in-flight attach has set the binding', async () => {
    const projStorage = new FakeStorage('fake://Acme')
    const model = buildModel(projStorage)
    const { provider, open, release } = wireGated(projStorage, model)
    const service = new ArchDiagramBindingService(provider)

    const doc = diagramFor(projStorage)
    // OpenDocuments fires first → sync() starts attachDoc, which is now parked on the
    // gated modelFor with the binding not yet created.
    open.Add(doc)
    await microtasks()

    // ActiveDocument would fire next → the contributor calls ensureBound. The attach
    // above is still in flight; ensureBound must wait for IT, not resolve early.
    const ensure = service.ensureBound(doc)
    release()          // let the model load (and the attach) complete
    await ensure

    expect(service.modelForDocument(doc)).toBeDefined()
})
