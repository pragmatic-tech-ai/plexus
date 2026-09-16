import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { ArchitectureModelService } from '../architecture-model-service.js'
import { ArchNewDiagramParticipant } from '../arch-new-diagram-participant.js'
import { ARCH_VIEWPOINTS_KEY } from '../arch-diagram-viewpoints-store.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import { ArchModel } from '../arch-model.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'

const MM = `namespace archmm {
  concept component {}
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames component
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
function op(storage: FakeStorage, type = 'architecture'): OpenProject {
    const project = new Project(type, 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    return { Project: project, Storage: storage } as unknown as OpenProject
}
// A fake DialogService whose Show immediately resolves `result` — standing in
// for the user confirming the picker with `result` selected, or (undefined)
// cancelling it.
function fakeDialogs(result: string[] | undefined): DialogService {
    return { Show: async () => result, Close: () => {} } as unknown as DialogService
}
async function seedArch(storage: FakeStorage): Promise<void> {
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name: 'Acme', version: 1 }))
    await storage.WriteText('x.diagram', JSON.stringify({ nodes: [], connectors: [], nextId: 1 }))
}
function providerWith(storage: FakeStorage, dialogs?: DialogService): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(ArchitectureModelService.Key, { modelFor: async () => buildModel(storage) } as unknown as ArchitectureModelService)
    if (dialogs !== undefined) provider.registerInstance(DialogService.Key, dialogs)
    return provider
}

test('picked viewpoints are serialized into the diagram file, and creation is kept', async () => {
    const storage = new FakeStorage('fake://Acme')
    await seedArch(storage)
    const keep = await new ArchNewDiagramParticipant(providerWith(storage, fakeDialogs(['DeploymentView']))).OnCreated(op(storage), 'x.diagram')
    expect(keep).toBe(true)
    const scene = JSON.parse(await storage.ReadText('x.diagram'))
    expect(scene.metadata[ARCH_VIEWPOINTS_KEY]).toEqual(['DeploymentView'])
    expect(scene.nodes).toEqual([])   // the scene is preserved
})

test('cancelling the picker aborts creation (keep=false) and writes nothing', async () => {
    const storage = new FakeStorage('fake://Acme')
    await seedArch(storage)
    const keep = await new ArchNewDiagramParticipant(providerWith(storage, fakeDialogs(undefined))).OnCreated(op(storage), 'x.diagram')
    expect(keep).toBe(false)
    const scene = JSON.parse(await storage.ReadText('x.diagram'))
    expect('metadata' in scene).toBe(false)
})

test('a non-architecture project is kept and ignored', async () => {
    const storage = new FakeStorage('fake://Plain')
    await seedArch(storage)
    const keep = await new ArchNewDiagramParticipant(providerWith(storage, fakeDialogs(['DeploymentView']))).OnCreated(op(storage, 'diagram'), 'x.diagram')
    expect(keep).toBe(true)
    expect('metadata' in JSON.parse(await storage.ReadText('x.diagram'))).toBe(false)
})

test('a non-.diagram path is kept and ignored', async () => {
    const storage = new FakeStorage('fake://Acme')
    await seedArch(storage)
    const keep = await new ArchNewDiagramParticipant(providerWith(storage, fakeDialogs(['DeploymentView']))).OnCreated(op(storage), 'notes.todl')
    expect(keep).toBe(true)
})

test('a headless host with no DialogService keeps the file without prompting', async () => {
    const storage = new FakeStorage('fake://Acme')
    await seedArch(storage)
    const keep = await new ArchNewDiagramParticipant(providerWith(storage)).OnCreated(op(storage), 'x.diagram')
    expect(keep).toBe(true)
    expect('metadata' in JSON.parse(await storage.ReadText('x.diagram'))).toBe(false)
})
