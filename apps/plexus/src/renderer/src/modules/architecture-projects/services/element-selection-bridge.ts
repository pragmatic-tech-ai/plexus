import { toElement, type Element, type Entity, type ToElementOptions } from '@pragmatic-tech-ai/todl'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { resolveElementPresentation } from './element-presentation.js'
import type { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import type { TodlPresentationRegistry } from '../../diagram/services/todl-presentation-registry.js'

// SelectedItems is inherited from Selector (readonly unknown[]) and not on the
// Diagram d.ts — reach it through a narrow interface.
interface WithSelectedItems { SelectedItems?: readonly unknown[] }

// Projects the active diagram's selected node view-models to Elements of the
// document's bound ArchModel, with presentation + provenance.home wired in.
// Unbound document or empty selection -> [].
export function selectionToElements(
    doc: DiagramDocument,
    bindingSvc: ArchDiagramBindingService,
    registry: TodlPresentationRegistry,
): Element[]
{
    const model = bindingSvc.modelForDocument(doc)
    if (model === undefined) return []
    const repo = model.repository()
    const byId = new Map(model.entities().map((e) => [e.id, e]))

    const view = doc.ActiveView as unknown as WithSelectedItems | undefined
    const selected = view?.SelectedItems ?? []
    const ids = selected
        .map((vm) => (vm as { Id?: string }).Id)
        .filter((id): id is string => id !== undefined)

    const opts: ToElementOptions = {
        presentation: (e, def) => resolveElementPresentation(repo, registry, e, def),
        homeOf: (id) => model.homeOf(id),
    }
    return ids
        .map((id) => byId.get(id))
        .filter((e): e is Entity => e !== undefined)
        .map((e) => toElement(repo, e, opts))
}
