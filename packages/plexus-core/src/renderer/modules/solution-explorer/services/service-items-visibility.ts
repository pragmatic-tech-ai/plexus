import { Disposable, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'

// Shared, observable toggle for whether "service items" — file-tree nodes whose name starts
// with "." (.claude, .git, …) — are shown in the Solution Explorer. One instance is owned by
// SolutionExplorerService (survives tree rebuilds) and handed to the FileTreeContributor and
// each ProjectHierarchyProvider. Flipping it notifies listeners, and each provider pushes a
// focused add/remove delta for its dot nodes through its live realize context — no tree
// rebuild, so expansion and selection of every other node are preserved. Default is hidden;
// direct callers that want everything (tests, other hosts) use ShowAll().
export class ServiceItemsVisibility
{
    private readonly listeners = new Set<() => void>()

    constructor(private show: boolean = false)
    {
    }

    public get Show(): boolean { return this.show }

    public Toggle(): void
    {
        this.show = !this.show
        for (const listener of [...this.listeners]) listener()
    }

    // Subscribe to visibility flips. The returned disposable unsubscribes.
    public OnChanged(listener: () => void): IDisposable
    {
        this.listeners.add(listener)
        return new Disposable(() => { this.listeners.delete(listener) })
    }

    public static ShowAll(): ServiceItemsVisibility { return new ServiceItemsVisibility(true) }
}
