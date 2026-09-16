import { ToolboxPage, type ToolboxItem } from '@pragmatic-tech-ai/mural/framework'

// A toolbox page whose CONTENT depends on the active architecture diagram (its
// viewpoint scope + already-placed nodes), not only on its model. It reconciles
// its items (by key) when its source changes and when it becomes the active
// context — but never while hidden, so switching away costs nothing.
export interface ScopedPageDeps
{
    // Compute the page's desired items now (reads active-diagram scope + placed).
    resolveItems(): ToolboxItem[]
    // Subscribe to the underlying model/source change signal (e.g. ArchModel.onChanged).
    onSourceChanged(cb: () => void): () => void
}

// Shared base for the two context-scoped page types below.
export abstract class ScopedToolboxPage extends ToolboxPage
{
    private off: (() => void) | undefined

    constructor(id: string, title: string, context: string, protected readonly deps: ScopedPageDeps)
    {
        super(id, title)
        this.Context = context
    }

    public override attach(): void
    {
        this.off = this.deps.onSourceChanged(() => this.refresh())
        this.refresh()
    }

    public override detach(): void
    {
        this.off?.()
        this.off = undefined
    }

    // Visibility flip (base) PLUS a cheap item reconcile when this page is the one
    // the active document activates — hidden pages skip the recompute entirely.
    public override applyContext(ctx: ReadonlySet<string>): void
    {
        super.applyContext(ctx)
        if (this.IsVisible) this.refresh()
    }

    public refresh(): void
    {
        this.reconcileItems(this.deps.resolveItems())
    }
}

// One page per model declaration across the open projects — its in-scope, not-yet-
// placed entities. Visible when the active document activates the model's context.
export class ModelToolboxPage extends ScopedToolboxPage {}

// One scenarios page per model — its in-scope scenario entities.
export class ScenarioToolboxPage extends ScopedToolboxPage {}
