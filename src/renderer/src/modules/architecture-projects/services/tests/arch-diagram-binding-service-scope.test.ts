import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, DiagramDocument, type IDocument, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { readViewpoints } from '../arch-diagram-viewpoints-store.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
const tick = () => new Promise((r) => setTimeout(r, 0))

async function scenario(seedScope?: string[]) {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', name: 'Acme', version: 1,
        ...(seedScope ? { diagrams: { 'v.diagram': { viewpoints: seedScope } } } : {}),
    }))
    const model = buildModel(storage)
    const open = new ObservableCollection<IDocument>()
    const host = { OpenDocuments: open } as unknown as DocumentsContentHostService
    const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    const op = { Project: project, Storage: storage } as unknown as OpenProject
    const explorer = { OpenProjects: new ObservableCollection<OpenProject>([op]) } as unknown as ProjectExplorerService

    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    provider.registerInstance(WorkspaceBaseResolver.Key, { ResolveForStorage: async () => ({ bases: [], problems: [] }) } as unknown as WorkspaceBaseResolver)
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    provider.registerInstance(ArchitectureModelService.Key, { modelFor: async () => model } as unknown as ArchitectureModelService)

    const doc = new DiagramDocument(new FileDiagramStorage('v.diagram', storage, null))
    const svc = new ArchDiagramBindingService(provider)
    open.Add(doc)
    await tick()
    return { svc, doc, storage, model }
}

test('attach reads the manifest scope', async () => {
    const { svc, doc } = await scenario(['ComponentView'])
    expect([...svc.scopeForDocument(doc)!]).toEqual(['ComponentView'])
})

test('no manifest entry defaults to all viewpoints', async () => {
    const { svc, doc } = await scenario()
    expect([...svc.scopeForDocument(doc)!].sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('setDocumentScope updates the binding and persists into the diagram metadata', async () => {
    const { svc, doc } = await scenario()
    await svc.setDocumentScope(doc, ['DeploymentView'])
    expect([...svc.scopeForDocument(doc)!]).toEqual(['DeploymentView'])
    // The selection now travels with the diagram (its metadata), not the manifest.
    expect(readViewpoints(doc)).toEqual(['DeploymentView'])
})
