import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlPresentationRegistry } from './todl-presentation-registry.js'

// Thin presentation VM: maps an entity key to its baked icon resource key via
// the presentation registry. This is the data-shaping TodlVisualResolver used to
// do internally — lifted onto the bound item so a plain ContentControl +
// DataTemplateSelector can render the icon by binding $Icon.IconKey. The selector
// only PICKS the template; this VM owns the data. Extends the lightweight
// Observable INPC root (no dependency-property system needed).
//
// Reactivity (icons upgrade live when async library discovery finishes) is
// OWNER-DRIVEN: the VM does NOT subscribe to the registry itself (a per-item
// subscription would leak as items are rebuilt). The long-lived owner that
// already tracks these items — the toolbox contributor, the arch-diagram
// binding — holds one registry.onChanged subscription and calls refresh() (for
// items refreshed in place) or simply recreates the items. Keeps the number of
// registry subscriptions bounded by owners, not by items.
export class EntityIconVM extends Observable
{
    private _iconKey: string

    constructor(
        private readonly registry: TodlPresentationRegistry,
        private readonly entityKey: string,
    )
    {
        super()
        this._iconKey = EntityIconVM.keyFor(registry, entityKey)
    }

    // entity key → baked resource key. A library term id resolves directly; a
    // bare meta-model term id (an arch canvas node carries one) resolves under
    // the `mm:` keyspace. Unknown → '' (the default glyph). Lifted verbatim from
    // the retired TodlVisualResolver.Resolve.
    public static keyFor(registry: TodlPresentationRegistry, entityKey: string): string
    {
        return registry.iconKeyFor(entityKey)
            ?? registry.iconKeyFor(`mm:${entityKey}`)
            ?? ''
    }

    public get IconKey(): string { return this._iconKey }

    // Recompute the icon key from the (possibly newly-populated) registry index
    // and notify if it changed. Called by the owning service on registry.onChanged
    // for items kept in place (canvas nodes); toolbox pages instead recreate items,
    // so their fresh VMs resolve the current key at construction.
    public refresh(): void
    {
        const next = EntityIconVM.keyFor(this.registry, this.entityKey)
        const prev = this._iconKey
        if (prev === next) return
        this._iconKey = next
        this.RaisePropertyChanged('IconKey', prev, next)
    }
}
