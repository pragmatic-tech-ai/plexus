import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramDocument, DialogService, type IDocument, type IToolboxDropFactory, type ToolboxDropContext } from '@pragmatic-tech-ai/mural/framework'

import { resolveDropActions, DropActionKind, type DropAction } from './arch-drop-resolver.js'
import { containmentMemberFor, isContainerConcept } from './containment.js'
import { showContainmentRejected } from './containment-modal.js'
import { showDropRejected } from './drop-rejection.js'
import { propagationFills } from './arch-propagate.js'
import { materializeOf } from './arch-materialize.js'
import { conceptTypeOf } from './arch-concept-type.js'
import { defaultLabel } from './arch-default-label.js'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { DropCandidateChooserService } from './drop-candidate-chooser-service.js'
import type { ArchModel } from './arch-model.js'
import { ArchNodeVM, ARCH_TILE_DEFAULT } from './arch-node-vm.js'

export const ArchInstanceDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ArchInstanceDropFactory')

// Drops a toolbox term onto a diagram. For an architecture diagram it routes the
// drop through the project's ArchModel (Phase-3 semantics): resolve candidate
// (X,m) actions from the meta-model schema — 0 reject, 1 auto, many chooser —
// then create the routed entity, wire the reference, materialize a bound Figure,
// and persist. A standalone diagram (no ArchModel) falls back to a plain shape.
export class ArchInstanceDropFactory implements IToolboxDropFactory
{
    public constructor(private readonly provider: IServiceProvider) {}

    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const doc = context.Mutator as unknown as IDocument
        const bindingSvc = this.provider.get(ArchDiagramBindingService.Key)
        const model = bindingSvc?.modelForDocument(doc)
        if (model === undefined) {
            // Standalone diagram: keep the old generic behavior.
            return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y) ?? null
        }

        // Read-filter: candidates + routing are scoped to the diagram's selected
        // viewpoints (default all when the binding service has no scope).
        const scope = bindingSvc?.scopeForDocument(doc) ?? new Set(model.viewpoints().map((v) => v.id))
        const actions = resolveDropActions(model.repository(), context.Descriptor.Key, scope)
        if (actions.length === 0) return null
        // A rejected drop can't be honored here (a container concept the diagram's
        // viewpoint doesn't frame). Interrupt with a comprehensive modal explaining
        // the problem instead of silently minting the wrong node.
        if (actions.length === 1 && actions[0].kind === DropActionKind.Rejected) {
            const termId = actions[0].term ?? context.Descriptor.Key
            showDropRejected(this.provider.get(DialogService.Key), model.repository(), termId, scope)
            return null
        }
        if (actions.length === 1) return this.apply(model, context, scope, actions[0])

        this.provider.getRequired(DropCandidateChooserService.Key).Show(actions, (chosen) => { this.apply(model, context, scope, chosen) })
        return null
    }

    // Create the entity for `action`, wire any reference, materialise an
    // ArchNodeVM at the drop position, and persist. Returns the VM (null if
    // no framing viewpoint). Label + Descriptor are left unset here; the
    // binding's rescan() (T6) is the sole authority that derives them.
    private apply(model: ArchModel, context: ToolboxDropContext, scope: Set<string>, action: DropAction): ArchNodeVM | null
    {
        // PLACE: bind the dropped term's OWN entity (a container concept, e.g. a
        // library location) as a node — no new instance, no model mutation. The
        // binding renders it as a container and projects its children from the
        // model. Skipped if it is already on this diagram (no duplicate).
        if (action.kind === DropActionKind.Place) {
            const entityId = action.term
            if (entityId === undefined) return null
            const doc = context.Mutator as unknown as DiagramDocument
            if ([...doc.Nodes].some((n) => (n as { Id?: string }).Id === entityId)) return null
            const vm = new ArchNodeVM()
            vm.Id = entityId
            const { X, Y } = context.Position
            doc.SetNodeVisual(entityId, { left: X, top: Y, ...ARCH_TILE_DEFAULT })
            context.Mutator.AddNode(vm)
            model.notifyChanged()   // rescan binds the placed entity + realizes its container
            return vm
        }

        const vp = [...model.repository().viewpointsFraming(action.concept)].find((v) => scope.has(v))
        if (vp === undefined) return null

        // Drop landed inside a model-backed container? Validate containment against
        // the meta-model BEFORE creating anything: illegal → modal + abort (no
        // entity); legal → record the member to write after creation, so the model
        // ref drives the visual nest (projectContainment). A generic container (id
        // not a repo entity) or empty canvas skips this — no model relation.
        const repo = model.repository()
        let nestMember: string | undefined
        let nestTarget: string | undefined
        const target = context.TargetContainer
        if (target?.Id !== undefined && repo.has(target.Id)) {
            const containerEntity = repo.entity(target.Id)
            if (containerEntity !== undefined && isContainerConcept(repo, containerEntity.concept)) {
                const member = containmentMemberFor(repo, action.concept, containerEntity.concept)
                if (member === undefined) {
                    const parentLabel = String(containerEntity.field('label') ?? containerEntity.id)
                    showContainmentRejected(this.provider.get(DialogService.Key), defaultLabel(repo, action), parentLabel)
                    return null
                }
                nestMember = member
                nestTarget = target.Id
            }
        }

        const entity = model.createInViewpoint(action.concept, vp)
        const schema = model.repository().effectiveSchema(action.concept)
        if (schema.fields.some((f) => f.name === 'label'))
            model.setField(entity.id, 'label', defaultLabel(model.repository(), action))
        if (action.kind === DropActionKind.Reference && action.member !== undefined && action.term !== undefined) {
            model.addRef(entity.id, action.member, action.term)
            // Propagate the dropped term's own references onto the instance's other
            // empty members (technology → its category, etc.). Gated by the effective
            // materialize.propagate flag (term → facet concept → root), default true.
            const ct = conceptTypeOf(model.repository(), action.term)
            const propagate = materializeOf(model.repository(), action.term)?.propagate
                ?? materializeOf(model.repository(), ct)?.propagate
                ?? materializeOf(model.repository(), action.concept)?.propagate
                ?? true
            if (propagate)
                for (const fill of propagationFills(model.repository(), action.concept, action.term, action.member))
                    model.addRef(entity.id, fill.member, fill.term)
        }

        // Legal drop into a model-backed container: write the containment ref. The
        // projection (projectContainment on the rescan below) nests the new node
        // under the container, preserving its drop-point position.
        if (nestMember !== undefined && nestTarget !== undefined)
            model.addRef(entity.id, nestMember, nestTarget)

        const { X, Y } = context.Position
        const vm = new ArchNodeVM()
        vm.Id = entity.id
        // Geometry lives on the container Figure + the document store, not the VM.
        // Write it by id; ContainerBound seeds the container when it realizes.
        ;(context.Mutator as unknown as DiagramDocument).SetNodeVisual(entity.id, { left: X, top: Y, ...ARCH_TILE_DEFAULT })
        context.Mutator.AddNode(vm)
        model.notifyChanged()      // rescan binds + labels the new node (T6)
        void model.save()          // persist the .todl (fire-and-forget)
        return vm
    }
}
