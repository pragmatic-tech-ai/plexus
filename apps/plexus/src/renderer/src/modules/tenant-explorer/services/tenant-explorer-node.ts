import { Observable, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'

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

    public static tenant(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Tenant, label)
    }

    public static environment(
        label: string, status: string, loader: () => Promise<TenantExplorerNode[]>,
    ): TenantExplorerNode
    {
        const node = new TenantExplorerNode(TenantExplorerNodeKind.Environment, label, status)
        node.loader = loader
        node.children.Add(TenantExplorerNode.message(TenantExplorerNode.LoadingLabel))
        return node
    }

    public static application(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Application, label)
    }

    public static graph(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Graph, label)
    }

    public static message(label: string): TenantExplorerNode
    {
        return new TenantExplorerNode(TenantExplorerNodeKind.Message, label)
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
        try { produced = await loader() }
        catch { produced = [TenantExplorerNode.message(TenantExplorerNode.FailedLabel)] }
        this.children.Clear()
        for (const c of produced) this.children.Add(c)
    }
}
