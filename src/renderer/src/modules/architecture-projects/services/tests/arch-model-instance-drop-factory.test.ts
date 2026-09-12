import { test, expect, vi } from 'vitest'
import { Point, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, ToolboxVisualDescriptor, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import { ArchToolboxItem } from '../../../diagram/services/arch-toolbox-item.js'
import { EntityIconVM } from '../../../diagram/services/entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ArchModelInstanceDropFactory, ArchModelInstanceDropFactoryKey, entityIdOf } from '../arch-model-instance-drop-factory.js'

function makeContext(doc: DiagramDocument, entityId: string): ToolboxDropContext {
    const descriptor = new ToolboxVisualDescriptor(TodlVisualResolverKey, 'service')
    const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry
    const item = new ArchToolboxItem('instance:' + entityId, 'Svc', descriptor, ArchModelInstanceDropFactoryKey, new EntityIconVM(reg, 'service'))
    return { Item: item, Descriptor: descriptor, Position: new Point(10, 20), Diagram: undefined as never, Mutator: doc }
}

// A stub binding service + model just recording the calls the factory makes.
function stubProvider(placed: Set<string>) {
    const model = { notifyChanged: vi.fn(), create: vi.fn(), addRef: vi.fn(), save: vi.fn() }
    const bindingSvc = {
        modelForDocument: () => model,
        isPlaced: (_doc: unknown, id: string) => placed.has(id),
    }
    const provider = { get: (k: unknown) => (k === ArchDiagramBindingService.Key ? bindingSvc : undefined) } as unknown as IServiceProvider
    return { provider, model }
}

test('entityIdOf strips the instance: prefix', () => {
    expect(entityIdOf('instance:svc1')).toBe('svc1')
    expect(entityIdOf('term:Stack.azure')).toBeUndefined()
})

test('placing an existing entity adds an ArchNodeVM at the drop point and notifies', () => {
    const doc = new DiagramDocument()
    const { provider, model } = stubProvider(new Set())
    const factory = new ArchModelInstanceDropFactory(provider)

    const result = factory.CreateDropped(makeContext(doc, 'svc1'))

    const nodes = doc.Nodes.ToArray().filter((n): n is ArchNodeVM => n instanceof ArchNodeVM)
    expect(nodes.length).toBe(1)
    expect(nodes[0].Id).toBe('svc1')
    // Geometry rides the document store by id (the container Figure owns it), not
    // the VM. The container seeds from this record when it realizes.
    const visual = doc.GetNodeVisual('svc1')
    expect(visual?.left).toBe(10)
    expect(visual?.top).toBe(20)
    expect(result).toBe(nodes[0])
    expect(model.notifyChanged).toHaveBeenCalledOnce()
    // Placement is diagram-only: no model mutation.
    expect(model.create).not.toHaveBeenCalled()
    expect(model.addRef).not.toHaveBeenCalled()
    expect(model.save).not.toHaveBeenCalled()
})

test('a second placement of an already-placed entity is a no-op (dedup)', () => {
    const doc = new DiagramDocument()
    const { provider, model } = stubProvider(new Set(['svc1']))   // already placed
    const factory = new ArchModelInstanceDropFactory(provider)

    const result = factory.CreateDropped(makeContext(doc, 'svc1'))

    expect(result).toBeNull()
    expect(doc.Nodes.ToArray().filter((n) => n instanceof ArchNodeVM).length).toBe(0)
    expect(model.notifyChanged).not.toHaveBeenCalled()
})
