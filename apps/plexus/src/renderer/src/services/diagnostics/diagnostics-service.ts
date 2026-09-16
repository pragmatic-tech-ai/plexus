import { ServiceBase, ServiceKey, ObservableCollection, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { Diagnostic } from './diagnostic.js'

// The single, source-agnostic store for every diagnostic in the app. Producers
// (the TODL validator today; diagram/other validators later) Publish the whole
// diagnostic set for one (owner, project) key at a time; the store replaces that
// slice atomically, so a producer's re-run naturally drops the problems it no
// longer reports. Consumers — the Problems dock (grouped over All) and the code
// editor (per-uri) — subscribe. It knows nothing about TODL.
export class DiagnosticsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagnosticsService>('DiagnosticsService')

    // Slices keyed "owner projectId" → that producer's diagnostics for that
    // project. The flat `All` collection is rebuilt from the slices on each change
    // so bindings over it stay live.
    private readonly slices = new Map<string, Diagnostic[]>()
    private readonly all = new ObservableCollection<Diagnostic>()
    private readonly uriListeners = new Map<string, Set<(d: Diagnostic[]) => void>>()
    // Store-level "something changed" listeners, fired ONCE per rebuild. Consumers
    // that recompute a whole view (the Problems dock) subscribe here rather than to
    // `All`'s per-item collection events — `All` fires N+1 times per Publish (Clear
    // + N Adds), and a full O(N) rebuild on each was O(N^2), freezing the app on a
    // project with hundreds of diagnostics.
    private readonly changedListeners = new Set<() => void>()

    constructor(provider: IServiceProvider) { super(provider) }

    public get All(): ObservableCollection<Diagnostic> { return this.all }

    // Subscribe to store changes, fired once per Publish/ClearProject (not once
    // per diagnostic). Returns an unsubscribe thunk.
    public Subscribe(listener: () => void): () => void
    {
        this.changedListeners.add(listener)
        return () => this.changedListeners.delete(listener)
    }

    private static sliceKey(owner: string, projectId: string): string { return `${owner} ${projectId}` }

    // Replace all diagnostics for one (owner, project). Empty array clears the slice.
    public Publish(owner: string, projectId: string, diagnostics: readonly Diagnostic[]): void
    {
        const key = DiagnosticsService.sliceKey(owner, projectId)
        if (diagnostics.length === 0) this.slices.delete(key)
        else this.slices.set(key, [...diagnostics])
        this.rebuild()
    }

    // Drop every owner's slice for a project (on project close).
    public ClearProject(projectId: string): void
    {
        let changed = false
        for (const key of [...this.slices.keys()]) {
            if (key.endsWith(` ${projectId}`)) { this.slices.delete(key); changed = true }
        }
        if (changed) this.rebuild()
    }

    // Current snapshot for a file.
    public ForUri(uri: string): Diagnostic[]
    {
        const out: Diagnostic[] = []
        for (const list of this.slices.values()) for (const d of list) if (d.uri === uri) out.push(d)
        return out
    }

    // Reactive per-file feed: fires immediately with the current snapshot, then on
    // every subsequent change. Returns an unsubscribe thunk.
    public SubscribeUri(uri: string, listener: (diags: Diagnostic[]) => void): () => void
    {
        let set = this.uriListeners.get(uri)
        if (set === undefined) { set = new Set(); this.uriListeners.set(uri, set) }
        set.add(listener)
        listener(this.ForUri(uri))
        return () => {
            const s = this.uriListeners.get(uri)
            if (s === undefined) return
            s.delete(listener)
            if (s.size === 0) this.uriListeners.delete(uri)
        }
    }

    // Recompute the flat All collection from the slices and notify per-uri listeners.
    private rebuild(): void
    {
        this.all.Clear()
        for (const list of this.slices.values()) for (const d of list) this.all.Add(d)
        for (const [uri, set] of this.uriListeners) {
            const snapshot = this.ForUri(uri)
            for (const l of set) l(snapshot)
        }
        for (const l of this.changedListeners) l()
    }
}
