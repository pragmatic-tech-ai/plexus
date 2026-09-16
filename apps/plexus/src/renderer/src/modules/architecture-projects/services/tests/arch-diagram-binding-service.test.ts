import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, type IDocument, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { ArchNodeVM } from '../arch-node-vm.js'
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
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`
const fileA = { uri: 'model-a.todl', text: `namespace archmm {
  model Arch : archmm conforms ComponentView { Component web {} }
}` }
const fileB = { uri: 'model-b.todl', text: `namespace archmm {
  model Arch : archmm conforms DeploymentView { Node host {} }
}` }

function buildModel(storage: FakeStorage): ArchModel {
    const mmDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(mmDoc))], [fileA, fileB], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

function diagramFor(projStorage: FakeStorage): DiagramDocument {
    const store = new FileDiagramStorage('view.diagram', projStorage, null)
    const doc = new DiagramDocument(store)
    const f = new ArchNodeVM()
    f.Id = 'web'
    doc.AddNode(f)
    return doc
}

// A ServiceProvider wired with a fake host, explorer (one architecture project),
// and a prebuilt ArchModel. `type` selects the project type.
function wire(projStorage: FakeStorage, model: ArchModel, type = 'architecture') {
    const open = new ObservableCollection<IDocument>()
    const host = { OpenDocuments: open } as unknown as DocumentsContentHostService
    const project = new Project(type, 'Acme', projStorage.Root, new ProjectNode('Acme', '', 'folder'))
    const op = { Project: project, Storage: projStorage } as unknown as OpenProject
    const explorer = { OpenProjects: new ObservableCollection<OpenProject>([op]) } as unknown as ProjectExplorerService
    const modelSvc = { modelFor: async () => model } as unknown as ArchitectureModelService

    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    provider.registerInstance(ArchitectureModelService.Key, modelSvc)
    return { provider, open }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

test('opening an architecture diagram attaches a binding (figure label syncs)', async () => {
    const projStorage = new FakeStorage('fake://Acme')
    const model = buildModel(projStorage)
    const { provider, open } = wire(projStorage, model)
    new ArchDiagramBindingService(provider)          // subscribes in ctor

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await tick()

    const web = doc.Nodes.ToArray().find((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === 'web')!
    expect(web.Label).toBe('web')                // proves attach() ran
    model.setField('web', 'label', 'Bound')
    expect(web.Label).toBe('Bound')              // proves onChanged wired
})

test('closing the document disposes its binding', async () => {
    const projStorage = new FakeStorage('fake://Acme')
    const model = buildModel(projStorage)
    const { provider, open } = wire(projStorage, model)
    new ArchDiagramBindingService(provider)

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await tick()
    const web = doc.Nodes.ToArray().find((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === 'web')!

    open.Remove(doc)                                 // close → dispose
    model.setField('web', 'label', 'AfterClose')
    expect(web.Label).toBe('web')                // detached: no update
})

test('a non-architecture project diagram is not attached', async () => {
    const projStorage = new FakeStorage('fake://Plain')
    const model = buildModel(projStorage)
    const { provider, open } = wire(projStorage, model, 'diagram')   // not architecture
    new ArchDiagramBindingService(provider)

    const doc = diagramFor(projStorage)
    open.Add(doc)
    await tick()
    const web = doc.Nodes.ToArray().find((n): n is ArchNodeVM => n instanceof ArchNodeVM && n.Id === 'web')!
    model.setField('web', 'label', 'X')
    // Never bound: the figure keeps its created default label, and the model
    // change does not propagate (an attached binding would have made it 'web').
    expect(web.Label).toBe('')
})
