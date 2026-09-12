import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlPresentationRegistry } from './todl-presentation-registry.js'

// Thin presentation VM: maps an entity key to its baked icon resource key via
// the presentation registry, and re-emits IconKey when the registry's index
// changes (icons arrive after async library discovery). This is the reactive
// data-shaping TodlVisualResolver used to do internally — lifted onto the bound
// item so a plain ContentControl + DataTemplateSelector can render the icon by
// binding $Icon.IconKey. The selector only PICKS the template; this VM owns the
// data. Extends the lightweight Observable INPC root (no dependency-property
// system needed).
export class EntityIconVM extends Observable
{
    private _iconKey: string
    private readonly unsub: () => void

    constructor(
        private readonly registry: TodlPresentationRegistry,
        private readonly entityKey: string,
    )
    {
        super()
        this._iconKey = EntityIconVM.keyFor(registry, entityKey)
        this.unsub = registry.onChanged(() => this.refresh())
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

    private refresh(): void
    {
        const next = EntityIconVM.keyFor(this.registry, this.entityKey)
        const prev = this._iconKey
        if (prev === next) return
        this._iconKey = next
        this.RaisePropertyChanged('IconKey', prev, next)
    }

    public dispose(): void
    {
        this.unsub()
    }
}
