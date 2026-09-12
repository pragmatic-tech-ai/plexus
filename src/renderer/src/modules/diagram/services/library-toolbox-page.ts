import { ToolboxPage, ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { ArchToolboxItem, ArchToolboxVisualKey } from './arch-toolbox-item.js'
import { EntityIconVM } from './entity-icon-vm.js'
import type { TodlPresentationRegistry } from './todl-presentation-registry.js'
import { ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'

// One toolbox page per published source ref (a library OR meta-model taxonomy).
// Content is publish-driven and pushed by the ToolboxService (which owns the
// publish trigger and the content scan): `setTerms` reconciles by key, so an
// unchanged republish leaves the live tiles untouched. Visible when the active
// document's ToolboxContexts contains this source's ref.
export class LibraryToolboxPage extends ToolboxPage
{
    // `keyPrefix` matches contributeTaxonomy's descriptor keying: '' for library
    // terms (bare id), 'mm:' for meta-model terms.
    // `registry` resolves each tile's EntityIconVM icon key ($Icon.IconKey). A
    // republish recreates items (reconcile-by-key keeps unchanged ones), so a fresh
    // VM resolves the current key — no per-item registry subscription needed here.
    constructor(id: string, label: string, sourceRef: string, private readonly keyPrefix: string, private readonly registry: TodlPresentationRegistry)
    {
        super(id, label)
        this.Context = sourceRef
    }

    public setTerms(terms: ReadonlyArray<{ id: string; label: string }>): void
    {
        // Dedup by term id — a term two sources both carry is one entity, so one
        // tile (and reconcile-by-key requires unique keys in the desired list).
        const seen = new Set<string>()
        const items: ArchToolboxItem[] = []
        for (const t of terms) {
            if (seen.has(t.id)) continue
            seen.add(t.id)
            const key = this.keyPrefix + t.id
            items.push(new ArchToolboxItem(
                'term:' + t.id,
                t.label,
                new ToolboxVisualDescriptor(ArchToolboxVisualKey, key),
                ArchInstanceDropFactoryKey,
                new EntityIconVM(this.registry, key),
            ))
        }
        this.reconcileItems(items)
    }
}
