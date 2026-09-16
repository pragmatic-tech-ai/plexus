import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'

import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { ArchNodeVM, ARCH_TILE_DEFAULT } from './arch-node-vm.js'

export const ArchModelInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchModelInstanceDropFactory')

// Model-page items are keyed `instance:<entityId>`; recover the entity id.
export function entityIdOf(itemId: string): string | undefined
{
    return itemId.startsWith('instance:') ? itemId.slice('instance:'.length) : undefined
}

// Places an EXISTING model entity as a node — no create/addRef/save, since
// placement changes only the diagram scene. Dedup: a no-op when the entity is
// already on this diagram. The binding's rescan() derives label/icon/edges.
export class ArchModelInstanceDropFactory implements IToolboxDropFactory
{
    public constructor(private readonly provider: IServiceProvider) {}

    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const doc = context.Mutator as unknown as IDocument
        const bindingSvc = this.provider.get(ArchDiagramBindingService.Key)
        const model = bindingSvc?.modelForDocument(doc)
        if (model === undefined) return null

        const entityId = entityIdOf(context.Item.Id)
        if (entityId === undefined) return null
        if (bindingSvc?.isPlaced(doc, entityId) === true) return null   // dedup

        const vm = new ArchNodeVM()
        vm.Id = entityId
        // Geometry lives on the container Figure + the document store, not the VM.
        ;(context.Mutator as unknown as DiagramDocument).SetNodeVisual(
            entityId, { left: context.Position.X, top: context.Position.Y, ...ARCH_TILE_DEFAULT })
        context.Mutator.AddNode(vm)
        model.notifyChanged()   // rescan binds label/icon + projects edges
        return vm
    }
}
