import {
    HierarchyItemId, ChildAdded, ChildRemoved, ChildUpdated, NodeSeverity, HierarchyPropertyId,
    type IHierarchyProvider, type HierarchyChange, type HierarchyNode, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ConnectionNodeKey } from './connection-node-key.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from './connection-view.js'

// Provides the global Connections subtree (one instance per open solution, not per member):
// under the model-assigned Connections node (a keyed node from ConnectionsRootContributor),
// one flat leaf per declared connection, decorated by health. Async-seeded like
// ProjectContentProvider — ObserveChildren returns its disposer synchronously and pushes
// ChildAdded after the async view fetch. Refreshes on IConnectionView.OnConnectionsViewChanged:
// re-fetches and diffs, so an edit is a ChildUpdated (leaf id kept, interned by connection id),
// an add/remove a ChildAdded/ChildRemoved.
export class ConnectionsProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.connections'
    public readonly ProviderId = ConnectionsProvider.Id
    private static readonly RootCanonical = 'connections'
    private static readonly DefaultIconSuffix = '-default'
    private static readonly ReadyIconSuffix = '-ready'
    private static readonly NoCredentialsIconSuffix = '-nocreds'
    private static readonly UnreachableIconSuffix = '-unreachable'
    private static readonly NoCredentialsMessage = 'No credentials: set a token or use an environment variable'

    private readonly nodeById = new Map<HierarchyItemId, HierarchyNode>()
    private readonly canonicalById = new Map<HierarchyItemId, string>()
    private readonly canonicalByName = new Map<string, HierarchyItemId>()
    private readonly leafIdByConnection = new Map<string, HierarchyItemId>()   // connection id -> leaf id
    private readonly leafIds = new Set<HierarchyItemId>()                      // minted leaf ids (for observe guard)
    private readonly present = new Set<string>()                               // connection ids currently emitted
    private rootId: HierarchyItemId | undefined                               // the model-assigned Connections node
    private rootSink: ((c: HierarchyChange) => void) | undefined
    private readonly offChanged: Disposable

    constructor(private readonly view: IConnectionView)
    {
        this.offChanged = this.view.OnConnectionsViewChanged(() => { void this.refresh() })
    }

    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        if (this.leafIds.has(node)) return () => {}   // leaves have no children
        // The Connections node is the only expandable node the model observes here; capture it.
        this.rootId = node
        this.rootSink = sink
        void this.realizeRoot()
        return () => { this.rootSink = undefined }
    }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        const node = this.nodeById.get(id)
        if (node === undefined) return undefined
        switch (prop)
        {
            case HierarchyPropertyId.Caption:       return node.Caption
            case HierarchyPropertyId.IconKey:       return node.IconKey
            case HierarchyPropertyId.ExtObject:     return node.ExtObject
            case HierarchyPropertyId.Severity:      return node.Severity
            case HierarchyPropertyId.CanonicalName: return this.canonicalById.get(id) ?? node.Key
            case HierarchyPropertyId.IsExpandable:  return node.IsExpandable === true
            default:                                return undefined
        }
    }

    public GetCanonicalName(id: HierarchyItemId): string { return this.canonicalById.get(id) ?? '' }
    public ParseCanonicalName(name: string): HierarchyItemId { return this.canonicalByName.get(name) ?? HierarchyItemId.Nil }
    public CanAccept(_target: HierarchyItemId, _drop: DropData): boolean { return false }

    public dispose(): void { this.offChanged.dispose() }

    private async realizeRoot(): Promise<void>
    {
        const sink = this.rootSink
        if (sink === undefined) return
        const views = await this.view.ConnectionsView()
        for (const v of views)
        {
            const id = this.ensureLeafId(v.Id)
            const node = this.buildLeaf(v)
            this.nodeById.set(id, node)
            this.present.add(v.Id)
            sink(new ChildAdded(id, node))
        }
    }

    private async refresh(): Promise<void>
    {
        const sink = this.rootSink
        if (sink === undefined) return
        const views = await this.view.ConnectionsView()
        const next = new Map(views.map((v) => [v.Id, v]))
        // Removals: present ids no longer in the next view.
        for (const oldId of [...this.present])
        {
            if (!next.has(oldId))
            {
                const leafId = this.leafIdByConnection.get(oldId)!
                sink(new ChildRemoved(leafId))
                this.forget(oldId, leafId)
            }
        }
        // Adds + updates.
        for (const v of views)
        {
            const leafId = this.ensureLeafId(v.Id)
            const node = this.buildLeaf(v)
            if (!this.present.has(v.Id))
            {
                this.nodeById.set(leafId, node)
                this.present.add(v.Id)
                sink(new ChildAdded(leafId, node))
            }
            else if (ConnectionsProvider.displayDiffers(this.nodeById.get(leafId), node))
            {
                this.nodeById.set(leafId, node)
                sink(new ChildUpdated(leafId, node))
            }
        }
    }

    private ensureLeafId(connectionId: string): HierarchyItemId
    {
        let id = this.leafIdByConnection.get(connectionId)
        if (id === undefined)
        {
            id = HierarchyItemId.Mint()
            this.leafIdByConnection.set(connectionId, id)
            this.leafIds.add(id)
            const canonical = `${ConnectionsProvider.RootCanonical}/${connectionId}`
            this.canonicalById.set(id, canonical)
            this.canonicalByName.set(canonical, id)
        }
        return id
    }

    private forget(connectionId: string, leafId: HierarchyItemId): void
    {
        this.present.delete(connectionId)
        this.leafIdByConnection.delete(connectionId)
        this.leafIds.delete(leafId)
        this.nodeById.delete(leafId)
        const canonical = this.canonicalById.get(leafId)
        this.canonicalById.delete(leafId)
        if (canonical !== undefined) this.canonicalByName.delete(canonical)
    }

    private buildLeaf(v: ConnectionLeafView): HierarchyNode
    {
        const warning = v.Health === ConnectionHealth.NoCredentials || v.Health === ConnectionHealth.Unreachable
        const error = v.Health === ConnectionHealth.Unreachable ? v.Message
            : v.Health === ConnectionHealth.NoCredentials ? ConnectionsProvider.NoCredentialsMessage
            : undefined
        const node: HierarchyNode = {
            Key: ConnectionNodeKey.Leaf,
            Caption: `${v.DisplayName} (${v.RegistryType})`,
            IconKey: ConnectionNodeKey.Leaf + ConnectionsProvider.iconSuffix(v.Health),
            ExtObject: Object.freeze({ id: v.Id, isDefault: v.IsDefault, isSolutionDefault: v.IsSolutionDefault }),
            Severity: warning ? NodeSeverity.Warning : NodeSeverity.Ok,
        }
        return error !== undefined ? { ...node, Error: error } : node
    }

    private static iconSuffix(health: ConnectionHealth): string
    {
        switch (health)
        {
            case ConnectionHealth.Default:       return ConnectionsProvider.DefaultIconSuffix
            case ConnectionHealth.Ready:         return ConnectionsProvider.ReadyIconSuffix
            case ConnectionHealth.NoCredentials: return ConnectionsProvider.NoCredentialsIconSuffix
            case ConnectionHealth.Unreachable:   return ConnectionsProvider.UnreachableIconSuffix
        }
    }

    private static displayDiffers(a: HierarchyNode | undefined, b: HierarchyNode): boolean
    {
        return a === undefined || a.Caption !== b.Caption || a.IconKey !== b.IconKey || a.Severity !== b.Severity || a.Error !== b.Error
    }
}
