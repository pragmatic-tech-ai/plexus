import { DiagramDocument, Figure } from '@pragmatic-tech-ai/mural/framework'
import type { Entity } from '@pragmatic-tech-ai/todl'
import { ArchNodeVM } from './arch-node-vm.js'
import type { ArchModel } from './arch-model.js'

// A diagram node that would fall out of scope under a narrowed viewpoint set.
export interface LeavingNode
{
    node: ArchNodeVM | Figure
    id: string
    label: string
}

// The nodes that would leave scope if `chosen` becomes the diagram's governing
// viewpoint set: every present node bound to a live entity whose concept is
// framed by NO viewpoint in `chosen`. Freeform nodes (no matching entity) and
// nodes still framed by a chosen viewpoint stay. `chosen` empty means "all
// viewpoints" — nothing leaves. Pure: it reads the doc and model but mutates
// neither, so the caller can list the casualties before confirming.
export function nodesLeavingScope(doc: DiagramDocument, model: ArchModel, chosen: readonly string[]): LeavingNode[]
{
    if (chosen.length === 0) return []
    const chosenSet = new Set(chosen)
    const repo = model.repository()
    const byId = new Map(model.entities().map((e) => [e.id, e]))
    const leaving: LeavingNode[] = []
    for (const node of doc.Nodes.ToArray()) {
        if (!(node instanceof ArchNodeVM || node instanceof Figure)) continue
        const id = node.Id
        if (id === undefined) continue
        const entity = byId.get(id)
        if (entity === undefined) continue   // freeform shape — not model-bound
        const framing = repo.viewpointsFraming(entity.concept)
        if (framing.some((vp) => chosenSet.has(vp))) continue   // still in scope
        leaving.push({ node, id, label: displayLabel(entity) })
    }
    return leaving
}

// An entity's display label: its `label`, else `name`, else its id. Mirrors the
// binding's labelling so the confirmation lists nodes the way the canvas shows
// them.
function displayLabel(entity: Entity): string
{
    const v = entity.field('label') ?? entity.field('name')
    return v !== undefined ? String(v) : entity.id
}
