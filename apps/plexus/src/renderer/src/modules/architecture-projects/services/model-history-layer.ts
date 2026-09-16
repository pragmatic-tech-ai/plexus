import { HistoryLayerId, type IHistoryLayer } from '@pragmatic-tech-ai/mural/framework'
import type { ArchModel } from './arch-model.js'

// The TODL model as a history layer: snapshots the own .todl files, restores them
// silently, and reconciles by firing the model's change signal (→ binding rescan)
// and re-saving. Registered on a document's DiagramHistory while the binding lives,
// so a model-mutating diagram edit undoes the model alongside the diagram visuals.
export class ModelHistoryLayer implements IHistoryLayer
{
    public readonly Id = HistoryLayerId.Model

    constructor(private readonly model: ArchModel) {}

    public Capture(): unknown { return this.model.toTodlByFile() }

    public Equals(a: unknown, b: unknown): boolean
    {
        const x = a as Map<string, string>, y = b as Map<string, string>
        if (x.size !== y.size) return false
        for (const [k, v] of x) if (y.get(k) !== v) return false
        return true
    }

    public Restore(snapshot: unknown): void
    {
        this.model.restore(snapshot as Map<string, string>)
    }

    // Post-restore: one rescan (via the model change signal) then re-save the
    // restored text (authoritative, last — supersedes any in-flight save).
    public Reconcile(): void
    {
        this.model.notifyChanged()
        void this.model.save()
    }
}
