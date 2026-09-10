import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'
import { ArchNodeVM } from '../arch-node-vm.js'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DropCandidateChooserService } from '../drop-candidate-chooser-service.js'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'

// `component` framed only by ComponentView; `node` only by DeploymentView.
// Both reference `technology`, so `azure` (a technology term) is a candidate
// under either — the scope decides which.
const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  concept node { relationship hosts -> technology; }
  viewpoint ComponentView : frames component
  viewpoint DeploymentView : frames node
  taxonomy Stack : represents technology { term azure {} }
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
function wire(doc: DiagramDocument, model: ArchModel, scope: Set<string>) {
    const provider = new ServiceProvider()
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: (d: unknown) => (d === doc ? scope : undefined),
    } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DropCandidateChooserService.Key, new DropCandidateChooserService(provider))
    return provider
}
function ctx(doc: DiagramDocument, key: string): ToolboxDropContext {
    return { Descriptor: { Key: key }, Position: { X: 1, Y: 2 }, Diagram: {}, Mutator: doc } as unknown as ToolboxDropContext
}

test('scope=ComponentView → the drop creates a component (node is out of scope)', () => {
    const model = buildModel(new FakeStorage('fake://Acme'))
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model, new Set(['ComponentView'])))
    const result = factory.CreateDropped(ctx(doc, 'Stack.azure')) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    expect(model.entities().map((e) => e.concept)).toEqual(['component'])
})

test('scope=DeploymentView → the same drop creates a node', () => {
    const model = buildModel(new FakeStorage('fake://Acme'))
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model, new Set(['DeploymentView'])))
    factory.CreateDropped(ctx(doc, 'Stack.azure'))
    expect(model.entities().map((e) => e.concept)).toEqual(['node'])
})
