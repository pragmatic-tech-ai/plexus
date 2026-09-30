import {
    HierarchyItemId, NodeSeverity, HierarchyPropertyId,
    type HierarchyChange, type HierarchyNode, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import type { LeadingBranch } from './project-branches-provider.js'
import { ConnectionNodeKey } from './connection-node-key.js'
import type { IConnectionView } from './connection-view.js'

// The per-project "Active connection" row: a single leaf whose caption tracks the effective
// connection resolving this project's references. Its caption is async (ActiveConnectionFor),
// so it emits a loading row synchronously and pushes a ChildUpdated (via OnRootChanged, which
// ProjectBranchesProvider wires) once resolved and whenever connections change.
export class ActiveConnectionLeadingBranch implements LeadingBranch
{
    private static readonly CaptionPrefix = 'Active connection: '
    private static readonly NonePlaceholder = '(none)'
    private static readonly LoadingPlaceholder = '…'
    private static readonly Canonical = 'active-connection'

    private readonly rootId = HierarchyItemId.Mint()
    private readonly handlers = new Set<() => void>()
    private currentNode: HierarchyNode
    private readonly offChanged: Disposable

    constructor(private readonly member: SolutionMember, private readonly view: IConnectionView)
    {
        this.currentNode = this.build(ActiveConnectionLeadingBranch.LoadingPlaceholder)
        this.offChanged = this.view.OnConnectionsViewChanged((affected) =>
        {
            if (affected === undefined || affected === this.member) void this.refresh()
        })
        void this.refresh()
    }

    public Owns(id: HierarchyItemId): boolean { return id === this.rootId }
    public RootId(): HierarchyItemId { return this.rootId }
    public RootNode(): HierarchyNode { return this.currentNode }
    public ObserveChildren(_node: HierarchyItemId, _sink: (c: HierarchyChange) => void): () => void { return () => {} }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        if (id !== this.rootId) return undefined
        switch (prop)
        {
            case HierarchyPropertyId.Caption:       return this.currentNode.Caption
            case HierarchyPropertyId.IconKey:       return this.currentNode.IconKey
            case HierarchyPropertyId.ExtObject:     return this.currentNode.ExtObject
            case HierarchyPropertyId.Severity:      return this.currentNode.Severity
            case HierarchyPropertyId.CanonicalName: return ActiveConnectionLeadingBranch.Canonical
            case HierarchyPropertyId.IsExpandable:  return false
            default:                                return undefined
        }
    }

    public GetCanonicalName(id: HierarchyItemId): string { return id === this.rootId ? ActiveConnectionLeadingBranch.Canonical : '' }
    public ParseCanonicalName(name: string): HierarchyItemId { return name === ActiveConnectionLeadingBranch.Canonical ? this.rootId : HierarchyItemId.Nil }
    public CanAccept(_target: HierarchyItemId, _drop: DropData): boolean { return false }

    public OnRootChanged(handler: () => void): Disposable
    {
        this.handlers.add(handler)
        return { dispose: () => { this.handlers.delete(handler) } }
    }

    public dispose(): void { this.offChanged.dispose() }

    private async refresh(): Promise<void>
    {
        const active = await this.view.ActiveConnectionFor(this.member)
        const name = active?.DisplayName ?? ActiveConnectionLeadingBranch.NonePlaceholder
        const node = this.build(name)
        if (node.Caption !== this.currentNode.Caption)
        {
            this.currentNode = node
            for (const h of this.handlers) h()
        }
    }

    private build(name: string): HierarchyNode
    {
        return {
            Key: ConnectionNodeKey.Active,
            Caption: ActiveConnectionLeadingBranch.CaptionPrefix + name,
            IconKey: ConnectionNodeKey.Active,
            ExtObject: Object.freeze({ member: this.member }),
            Severity: NodeSeverity.Ok,
        }
    }
}
