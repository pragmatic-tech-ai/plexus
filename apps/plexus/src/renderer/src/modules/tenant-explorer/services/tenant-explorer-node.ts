import { Observable, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// A uniform, read-only tree node for the Tenant Explorer panel — one type for
// every level (tenant, environment, application, graph, message) so a single
// HierarchicalDataTemplate governs the tree. The row template derives the icon
// from Kind. Environment nodes are lazy: a "Loading…" sentinel is seeded and
// OnExpand() runs the loader once, swapping in the produced children.
export enum TenantExplorerNodeKind
{
    Tenant = 'tenant',
    Environment = 'environment',
    Application = 'application',
    Graph = 'graph',
    Message = 'message',
}

export class TenantExplorerNode extends Observable
{
    private static readonly LoadingLabel = 'Loading…'
    private static readonly FailedLabel = 'Failed to load'

    private readonly kind: TenantExplorerNodeKind
    private readonly label: string
    private readonly status: string
    private readonly children = new ObservableCollection<TenantExplorerNode>()
    private loader?: () => Promise<TenantExplorerNode[]>
    private loaded = false
    // The deployed-graph identity a Graph node resolves (its environment TargetRef);
    // undefined for every other kind.
    private target?: TargetRef
    // Set by the owner (TenantExplorerService) for a Graph node; run when the tree
    // activates the row (double-click / Enter). Mirrors `loader`/OnExpand.
    private onActivate?: () => void

    private constructor(kind: TenantExplorerNodeKind, label: string, status = '')
    {
        super()
        this.kind = kind
        this.label = label
        this.status = status
    }

    public get Kind(): TenantExplorerNodeKind { return this.kind }
    public get Label(): string { return this.label }
    public get Status(): string { return this.status }
    public get Children(): ObservableCollection<TenantExplorerNode> { return this.children }
    public get Target(): TargetRef | undefined { return this.target }

    public static Tenant(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Tenant, label)
    }

    public static Environment(
        label: string, status: string, loader: () => Promise<TenantExplorerNode[]>,
    ): TenantExplorerNode
    {
        const node = new TenantExplorerNode(TenantExplorerNodeKind.Environment, label, status)
        node.loader = loader
        node.children.Add(TenantExplorerNode.Message(TenantExplorerNode.LoadingLabel))
        return node
    }

    public static Application(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Application, label)
    }

    public static Graph(label: string, target?: TargetRef): TenantExplorerNode
    {
        const node = new TenantExplorerNode(TenantExplorerNodeKind.Graph, label)
        node.target = target
        return node
    }

    public static Message(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Message, label)
    }

    // Wire what happens when this row is activated (double-click / Enter). The tree
    // calls OnActivate() on the bound node; the owner sets the behaviour here.
    public SetActivation(handler: () => void): void
    {
        this.onActivate = handler
    }

    // Called by the tree when a leaf row is activated. No-op unless an activation
    // was set (only Graph nodes carry one).
    public OnActivate(): void
    {
        this.onActivate?.()
    }

    // Runs the loader exactly once; no-op on non-lazy nodes and later expands.
    public OnExpand(): void
    {
        if (this.loaded || this.loader === undefined) return
        this.loaded = true
        void this.runLoader(this.loader)
    }

    private async runLoader(loader: () => Promise<TenantExplorerNode[]>): Promise<void>
    {
        let produced: TenantExplorerNode[]
        try
        {
            produced = await loader()
        }
        catch
        {
            produced = [TenantExplorerNode.Message(TenantExplorerNode.FailedLabel)]
        }
        this.children.Clear()
        for (const c of produced) this.children.Add(c)
    }
}
