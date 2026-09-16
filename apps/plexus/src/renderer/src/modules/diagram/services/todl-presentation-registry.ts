import { Application, ResourceDictionary, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { setIconResourceResolver } from './icon-key-converter.js'

// What a source contributes on each discover(): its baked icon ASSETS (geometries
// / ImageBrushes keyed by resource key) and an entityKey → resource-key index
// (library term/class → '<id>'; meta-model entity → 'mm:<id>').
export interface PresentationContribution
{
    assets: ResourceDictionary
    iconKeys: Map<string, string>
}

// A single presentation source contributing to the registry. Each has a stable id
// (idempotency key for registerSource) and loads its contribution on each discover().
export interface PresentationSource
{
    id: string
    load(): Promise<PresentationContribution>
}

// App-global registry that aggregates every registered PresentationSource's icon
// assets into one ResourceDictionary — merged into Application.Resources as a single
// atomic swap so DynamicResource consumers receive one merged-dictionary
// notification (O(1)) — and unions their entityKey → resource-key indexes.
//
// The one default visual template resolves an entity's icon by looking its
// resource key up in this index (iconKeyFor) and drawing the geometry that key
// names. resolveAsset() reads the owned aggregate so the IconKeyConverter works
// headless (no Application.current); discover() bridges the converter to it.
export class TodlPresentationRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<TodlPresentationRegistry>('TodlPresentationRegistry')

    // Registered sources keyed by their stable id — idempotent: re-registering the
    // same id replaces the previous entry.
    private readonly sources = new Map<string, PresentationSource>()

    // The currently owned aggregate of icon assets. resolveAsset() reads from here,
    // so headless callers still work. Rebuilt wholesale on each discover().
    private aggregate = new ResourceDictionary()
    // entityKey → resource key, unioned across sources. Rebuilt on each discover().
    private index = new Map<string, string>()
    // The currently merged ResourceDictionary instance (undefined until the first
    // non-empty discover()).
    private merged: ResourceDictionary | undefined

    private readonly listeners = new Set<(key: string) => void>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    // Register a source by id. Idempotent: re-registering the same id replaces the
    // previous entry (the new source's contribution takes effect on next discover()).
    public registerSource(src: PresentationSource): void
    {
        this.sources.set(src.id, src)
    }

    // Run all registered sources, merge their assets app-global (one swap → O(1)
    // notifications), and rebuild the entityKey index. Skip the swap when the next
    // asset dict is empty AND was never merged, so a zero-asset discover fires zero
    // app-resource notifications. Bridges the IconKeyConverter to the owned
    // aggregate. onChanged fires once per indexed entity key.
    public async discover(): Promise<void>
    {
        const next = new ResourceDictionary()
        next.StyleParticipating = false
        const nextIndex = new Map<string, string>()

        let assetCount = 0
        for (const source of this.sources.values()) {
            const { assets, iconKeys } = await source.load()
            for (const [k, v] of assets.Entries()) { next.Set(k, v); assetCount++ }
            for (const [k, v] of iconKeys) nextIndex.set(k, v)
        }

        if (assetCount > 0 || this.merged !== undefined) {
            Application.current?.Resources.ReplaceMergedDictionary(this.merged, next)
            this.merged = next
        }
        // Diff the new index against the prior one BEFORE overwriting it, so only
        // entities whose icon actually changed re-resolve — the first discover
        // (empty prior index) treats every key as new.
        const prevIndex = this.index
        const changed = new Set<string>()
        for (const [k, v] of nextIndex) { if (prevIndex.get(k) !== v) changed.add(k) }
        for (const k of prevIndex.keys()) { if (!nextIndex.has(k)) changed.add(k) }   // removed → fall back to default glyph
        this.aggregate = next
        this.index = nextIndex

        // Headless-safe resource lookup for the IconKeyConverter (reads the owned
        // aggregate, not Application.Resources).
        setIconResourceResolver((k) => this.aggregate.Resolve(k))

        // Notify subscribers so live presenters re-resolve their icon — only for
        // the keys whose mapping changed this discover.
        for (const key of changed) {
            for (const cb of [...this.listeners]) cb(key)
        }
    }

    // The icon resource key for an entity (descriptor key), or undefined when the
    // entity has no indexed icon (→ the default glyph). Reads the owned index, so
    // it works headless.
    public iconKeyFor(entityKey: string): string | undefined
    {
        return this.index.get(entityKey)
    }

    // Resolve a baked icon asset (geometry / ImageBrush) by its resource key from
    // the owned aggregate. Headless-safe.
    public resolveAsset(resourceKey: string): unknown
    {
        return this.aggregate.Resolve(resourceKey)
    }

    // Subscribe to key-level change notifications fired after each discover().
    // Returns an unsubscribe function.
    public onChanged(cb: (key: string) => void): () => void
    {
        this.listeners.add(cb)
        return () => { this.listeners.delete(cb) }
    }
}
