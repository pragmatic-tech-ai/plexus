import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, DialogService, Figure, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'
import { load, toJSON, Repository, graphFromJSON, ModelDraft } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchModel } from '../arch-model.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DropCandidateChooserService } from '../drop-candidate-chooser-service.js'
import { ArchInstanceDropFactory } from '../arch-instance-drop-factory.js'
import { ArchNodeVM } from '../arch-node-vm.js'

const MM = `namespace archmm {
  concept technology {}
  concept component { relationship realisedBy -> technology; }
  viewpoint ComponentView : frames component
  taxonomy Stack : represents technology { term azure {} }
}`
function buildModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

// A provider whose ArchDiagramBindingService maps `doc` → `model`.
function wire(doc: DiagramDocument, model: ArchModel | undefined) {
    const provider = new ServiceProvider()
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: () => undefined,   // falls back to all viewpoints
    } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DropCandidateChooserService.Key, new DropCandidateChooserService(provider))
    return provider
}

function ctx(doc: DiagramDocument, key: string): ToolboxDropContext {
    return { Descriptor: { Key: key }, Position: { X: 5, Y: 6 }, Diagram: {}, Mutator: doc } as unknown as ToolboxDropContext
}

test('a single-candidate drop creates the routed entity + an ArchNodeVM at the drop position', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))

    const result = factory.CreateDropped(ctx(doc, 'Stack.azure')) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    // Entity created: a component that references azure via realisedBy.
    const comp = model.entities().find((e) => e.concept === 'component')!
    expect(comp).toBeDefined()
    expect(result.Id).toBe(comp.id)
    // Position rides the document store by id (the container Figure owns geometry),
    // not the VM. Must match the drop context (X=5, Y=6).
    const visual = doc.GetNodeVisual(comp.id)
    expect(visual?.left).toBe(5)
    expect(visual?.top).toBe(6)
    // Label/Descriptor are NOT set by this task (T6 fills them via rescan).
    // The node must be present in the document's Nodes collection.
    expect([...doc.Nodes].includes(result)).toBe(true)
})

test('a no-candidate drop returns null and mutates nothing', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))
    const before = model.entities().length
    expect(factory.CreateDropped(ctx(doc, 'nonesuch'))).toBeNull()
    expect(model.entities().length).toBe(before)
})

test('a non-architecture document falls back to a plain CreateNode', () => {
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, undefined))   // no model
    const result = factory.CreateDropped(ctx(doc, 'rectangle')) as Figure
    expect(result).toBeInstanceOf(Figure)
    expect(result.Kind).toBe('rectangle')
})

const PROP_MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept category {}
  concept technology { relationship applicableTo -> category; }
  concept component {
    annotate materialize {}
    relationship implementedBy -> technology;
    relationship categorisedAs -> category;
  }
  viewpoint ComponentView : frames component
  taxonomy Cats : represents category { term ai {} }
  taxonomy Stack : represents technology { term azure { applicableTo = Cats.ai; } }
}`

function buildPropModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: PROP_MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

test('dropping a technology wires the primary member AND back-fills the category by propagation', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildPropModel(storage)
    const doc = new DiagramDocument()
    const factory = new ArchInstanceDropFactory(wire(doc, model))

    const result = factory.CreateDropped(ctx(doc, 'Stack.azure')) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    const comp = model.entities().find((e) => e.concept === 'component')!
    // Primary member wired to the dropped technology term.
    expect(model.repository().refs(comp.id, 'implementedBy')).toContain('Stack.azure')
    // Category back-filled from the technology term's own applicableTo ref.
    expect(model.repository().refs(comp.id, 'categorisedAs')).toContain('Cats.ai')
})

// ── Drop INTO a container: validate containment, modal on reject (Task 5) ──────
// `location` and `zone` are both container concepts (targets of component.in and
// region.in). A dropped component may nest in a location (component.in -> location)
// but NOT in a zone (no relationship).
const CONTAIN_MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept location {}
  concept zone {}
  concept region { relationship in -> zone; }
  concept technology {}
  concept component {
    annotate materialize {}
    relationship realisedBy -> technology;
    relationship in -> location;
  }
  viewpoint V : frames component, location, zone
  taxonomy Stack : represents technology { term azure {} }
}`
function buildContainModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: CONTAIN_MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}
// A provider that also carries a spy DialogService, so the reject modal is observable.
function wireWithDialogs(doc: DiagramDocument, model: ArchModel): { provider: ServiceProvider; shows: Array<{ Title?: string }> } {
    const provider = wire(doc, model)
    const shows: Array<{ Title?: string }> = []
    provider.registerInstance(DialogService.Key, { Show: (o: { Title?: string }) => { shows.push(o); return Promise.resolve(undefined) }, Close: () => {} } as unknown as DialogService)
    return { provider, shows }
}
function ctxInto(doc: DiagramDocument, key: string, targetId: string): ToolboxDropContext {
    return { Descriptor: { Key: key }, Position: { X: 5, Y: 6 }, Diagram: {}, Mutator: doc, TargetContainer: { Id: targetId } } as unknown as ToolboxDropContext
}

test('a legal drop into a model-backed container writes the containment ref, no modal', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildContainModel(storage)
    const doc = new DiagramDocument()
    const loc = model.createInViewpoint('location', 'V')
    const { provider, shows } = wireWithDialogs(doc, model)
    const factory = new ArchInstanceDropFactory(provider)

    const result = factory.CreateDropped(ctxInto(doc, 'Stack.azure', loc.id)) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    const comp = model.entities().find((e) => e.concept === 'component')!
    // The containment ref was written → projection will nest it under the container.
    expect(model.repository().refs(comp.id, 'in')).toContain(loc.id)
    expect(shows.length).toBe(0)
})

// A container-concept term is PLACED as-is (binds the existing entity), not
// materialized into a component. `Regions.azure` is a location term (container
// concept); dropping it places that location as a node, creating no new entity.
const PLACE_MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept location {}
  concept component { annotate materialize {} relationship in -> location; }
  viewpoint V : frames component, location
  taxonomy Regions : represents location { term azure {} }
}`
function buildPlaceModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: PLACE_MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

test('dropping a location term places the location entity itself (container), no new entity', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildPlaceModel(storage)
    const doc = new DiagramDocument()
    const before = model.entities().length
    const factory = new ArchInstanceDropFactory(wire(doc, model))

    const result = factory.CreateDropped(ctx(doc, 'Regions.azure')) as ArchNodeVM
    expect(result).toBeInstanceOf(ArchNodeVM)
    expect(result.Id).toBe('Regions.azure')          // the location entity itself, not a fresh component
    expect(model.entities().length).toBe(before)     // no new instance materialized
    expect([...doc.Nodes].includes(result)).toBe(true)
    const visual = doc.GetNodeVisual('Regions.azure')
    expect(visual?.left).toBe(5)

    // Dropping it again does not place a duplicate.
    expect(factory.CreateDropped(ctx(doc, 'Regions.azure'))).toBeNull()
})

// A container-concept term dropped on a diagram whose viewpoint does NOT frame it
// must be REJECTED with an explanatory modal — not silently turned into a component
// (the facet-drop fallback). `Scenarios` frames component but not location.
const REJECT_MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept location {}
  concept component { annotate materialize {} relationship in -> location; }
  viewpoint Model : frames component, location
  viewpoint Scenarios : frames component
  taxonomy Regions : represents location { term azure {} }
}`
function buildRejectModel(storage: FakeStorage): ArchModel {
    const draft = ModelDraft.fromSources([new Repository(graphFromJSON(toJSON(load([{ uri: 'mm.todl', text: REJECT_MM }]).model)))], [], { namespace: 'archmm' })
    return new ArchModel(draft, storage, 'archmm')
}

test('dropping a location where its viewpoint is not framed is REJECTED with a modal, no component', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildRejectModel(storage)
    const doc = new DiagramDocument()
    const before = model.entities().length
    const provider = new ServiceProvider()
    const shows: Array<{ Title?: string }> = []
    provider.registerInstance(ArchDiagramBindingService.Key, {
        modelForDocument: (d: unknown) => (d === doc ? model : undefined),
        scopeForDocument: () => new Set(['Scenarios']),   // frames component, NOT location
    } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DropCandidateChooserService.Key, new DropCandidateChooserService(provider))
    provider.registerInstance(DialogService.Key, { Show: (o: { Title?: string }) => { shows.push(o); return Promise.resolve(undefined) }, Close: () => {} } as unknown as DialogService)
    const factory = new ArchInstanceDropFactory(provider)

    const result = factory.CreateDropped(ctx(doc, 'Regions.azure'))
    expect(result).toBeNull()                          // nothing placed
    expect(shows.length).toBe(1)                       // the explanatory modal fired
    expect(shows[0]!.Title).toContain('Azure')         // "Can't place "Azure" here"
    expect(model.entities().length).toBe(before)       // NO component minted
    expect(model.entities().some((e) => e.concept === 'component')).toBe(false)
    expect([...doc.Nodes].length).toBe(0)
})

test('an illegal drop into a container shows the modal, creates no entity', () => {
    const storage = new FakeStorage('fake://Acme')
    const model = buildContainModel(storage)
    const doc = new DiagramDocument()
    const zone = model.createInViewpoint('zone', 'V')
    const before = model.entities().length
    const { provider, shows } = wireWithDialogs(doc, model)
    const factory = new ArchInstanceDropFactory(provider)

    const result = factory.CreateDropped(ctxInto(doc, 'Stack.azure', zone.id))
    expect(result).toBeNull()
    expect(shows.length).toBe(1)
    expect(shows[0]!.Title).toBe('Cannot nest here')
    // No component was created (the drop aborted before createInViewpoint).
    expect(model.entities().length).toBe(before)
    expect(model.entities().some((e) => e.concept === 'component')).toBe(false)
})
