import {
    NodeSeverity, NodeKey,
    type HierarchyItem, type HierarchyItemInit,
    type IHierarchyProvider, type IRealizeContext, type DropData, type NodeContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Disposable, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import { ConnectionNodeKey } from './connection-node-key.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from './connection-view.js'

// Provides the global Connections subtree (one instance per open solution, not per member):
// under the model-assigned Connections node, one flat leaf per declared connection,
// decorated by health. Migrated to mural's B+C1 provider contract: Realize PUSHES the
// leaves into the Connections root via the IRealizeContext and returns the
// OnConnectionsViewChanged subscription as its teardown. A connection keeps its leaf
// instance (interned by connection id), so an edit mutates the SAME row in place; an
// add/remove inserts/removes it. The canonical scheme is preserved: connections/<id>.
export class ConnectionsProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.connections'
    public readonly ProviderId = ConnectionsProvider.Id
    private static readonly RootCanonical = 'connections'
    private static readonly CanonicalSeparator = '/'
    private static readonly CaptionSuffix = ' ('
    private static readonly CaptionSuffixEnd = ')'
    private static readonly DefaultIconSuffix = '-default'
    private static readonly ReadyIconSuffix = '-ready'
    private static readonly NoCredentialsIconSuffix = '-nocreds'
    private static readonly UnreachableIconSuffix = '-unreachable'
    private static readonly NoCredentialsMessage = 'No credentials: set a token or use an environment variable'

    private readonly leafItemById = new Map<string, HierarchyItem>()   // connection id -> leaf
    private readonly present = new Set<string>()                       // connection ids currently inserted
    private readonly itemByCanonical = new Map<string, HierarchyItem>()
    private readonly canonicalByItem = new Map<HierarchyItem, string>()
    private rootItem: HierarchyItem | undefined

    constructor(private readonly view: IConnectionView)
    {
    }

    public Realize(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (item.Key !== NodeKey.Connections) return Disposable.None   // leaves have no children
        this.rootItem = item
        const watch = { disposed: false }
        const off = this.view.OnConnectionsViewChanged(() =>
        {
            if (!watch.disposed) void this.populateRoot(context)
        })
        void this.populateRoot(context)
        return new Disposable(() =>
        {
            watch.disposed = true
            off.dispose()
        })
    }

    // The Connections subtree mints its own rows; nothing is contributor-injected.
    public Integrate(_item: HierarchyItem, _contributions: readonly NodeContribution[]): void
    {
    }

    public GetCanonicalName(item: HierarchyItem): string
    {
        if (item.Key !== NodeKey.Connections)
        {
            const ext = item.ExtObject as { id: string }
            return ConnectionsProvider.RootCanonical + ConnectionsProvider.CanonicalSeparator + ext.id
        }
        return ConnectionsProvider.RootCanonical
    }

    public ParseCanonicalName(name: string): HierarchyItem | undefined
    {
        if (name === ConnectionsProvider.RootCanonical) return this.rootItem
        return this.itemByCanonical.get(name)
    }

    public CanAccept(_target: HierarchyItem, _drop: DropData): boolean { return false }

    private async populateRoot(context: IRealizeContext): Promise<void>
    {
        const views = await this.view.ConnectionsView()
        const next = new Map(views.map((v) => [v.Id, v]))
        for (const id of [...this.present])
        {
            if (next.has(id)) continue
            const leaf = this.leafItemById.get(id)
            if (leaf === undefined) continue
            context.RemoveChild(leaf)
            this.forget(id, leaf)
        }
        for (const v of views)
        {
            let leaf = this.leafItemById.get(v.Id)
            if (leaf === undefined)
            {
                leaf = context.NewItem(ConnectionNodeKey.Leaf, ConnectionsProvider.leafInit(v))
                this.leafItemById.set(v.Id, leaf)
                this.setCanonical(leaf, ConnectionsProvider.RootCanonical + ConnectionsProvider.CanonicalSeparator + v.Id)
            }
            else
            {
                ConnectionsProvider.applyLeaf(leaf, v)
            }
            this.present.add(v.Id)
            context.InsertChild(leaf)
        }
    }

    private setCanonical(item: HierarchyItem, canonical: string): void
    {
        this.canonicalByItem.set(item, canonical)
        this.itemByCanonical.set(canonical, item)
    }

    private forget(connectionId: string, leaf: HierarchyItem): void
    {
        this.present.delete(connectionId)
        this.leafItemById.delete(connectionId)
        const canonical = this.canonicalByItem.get(leaf)
        if (canonical !== undefined) this.itemByCanonical.delete(canonical)
        this.canonicalByItem.delete(leaf)
    }

    private static leafInit(v: ConnectionLeafView): HierarchyItemInit
    {
        return {
            Caption: ConnectionsProvider.captionOf(v),
            IconKey: ConnectionNodeKey.Leaf + ConnectionsProvider.iconSuffix(v.Health),
            Severity: ConnectionsProvider.severityOf(v),
            Error: ConnectionsProvider.errorOf(v),
            IsExpandable: false,
            ExtObject: Object.freeze({ id: v.Id, isDefault: v.IsDefault, isSolutionDefault: v.IsSolutionDefault }),
            CanonicalSegment: v.Id,
        }
    }

    private static applyLeaf(leaf: HierarchyItem, v: ConnectionLeafView): void
    {
        leaf.Caption = ConnectionsProvider.captionOf(v)
        leaf.IconKey = ConnectionNodeKey.Leaf + ConnectionsProvider.iconSuffix(v.Health)
        leaf.Severity = ConnectionsProvider.severityOf(v)
        leaf.Error = ConnectionsProvider.errorOf(v)
        leaf.ExtObject = Object.freeze({ id: v.Id, isDefault: v.IsDefault, isSolutionDefault: v.IsSolutionDefault })
    }

    private static captionOf(v: ConnectionLeafView): string
    {
        return v.DisplayName + ConnectionsProvider.CaptionSuffix + v.RegistryType + ConnectionsProvider.CaptionSuffixEnd
    }

    private static severityOf(v: ConnectionLeafView): NodeSeverity
    {
        const warning = v.Health === ConnectionHealth.NoCredentials || v.Health === ConnectionHealth.Unreachable
        return warning ? NodeSeverity.Warning : NodeSeverity.Ok
    }

    private static errorOf(v: ConnectionLeafView): string | undefined
    {
        if (v.Health === ConnectionHealth.Unreachable) return v.Message
        if (v.Health === ConnectionHealth.NoCredentials) return ConnectionsProvider.NoCredentialsMessage
        return undefined
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
}
