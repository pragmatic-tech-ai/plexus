import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext, type ICommandContributor } from '@pragmatic-tech-ai/mural/framework'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import { ConnectionNodeKey } from './connection-node-key.js'
import { LazySubmenuPlaceholder } from './lazy-submenu-placeholder.js'
import type { IConnectionView } from './connection-view.js'

// Opens the connection editor dialog (New / Edit). The app supplies the implementation (it
// owns the window/dialog host); the contributor stays UI-free and unit-testable.
export interface IConnectionEditorLauncher
{
    OpenNew(): void
    OpenEdit(connectionId: string): void
}

// DI token the app registers its editor-launcher under; SolutionExplorerService resolves it
// to build the ConnectionActionsContributor.
export const ConnectionEditorLauncherKey = new ServiceKey<IConnectionEditorLauncher>('ConnectionEditorLauncher')

// The identity a connection leaf carries as its ExtObject.
interface LeafData
{
    readonly id: string
    readonly isDefault: boolean
    readonly isSolutionDefault: boolean
}

// Dispatches the Connections-branch context-menu commands, routed to IConnectionView + the
// editor launcher. The Connections node offers New Connection…; a leaf offers Edit… / Test /
// Make Default (non-executable when already default) / Make Solution Default / a selection-
// aware Remove; the per-project active-connection row offers an Active connection ▸ submenu
// (supplied lazily by ConnectionActiveSubmenuContributor; the current pick non-executable).
export class ConnectionActionsContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<ConnectionActionsContributor>('ConnectionActionsContributor')

    public static readonly NewId = 'connection.new'
    public static readonly EditId = 'connection.edit'
    public static readonly TestId = 'connection.test'
    public static readonly MakeDefaultId = 'connection.makeDefault'
    public static readonly MakeSolutionDefaultId = 'connection.makeSolutionDefault'
    public static readonly RemoveId = 'connection.remove'
    public static readonly ActiveId = 'connection.active'
    // Dynamic child ids: an executable pick `active::<connId>` (or the solution-default
    // sentinel) and the current pick `active.current::<connId>` (non-executable).
    public static readonly ActiveChildPrefix = 'connection.active::'
    public static readonly ActiveCurrentChildPrefix = 'connection.active.current::'
    public static readonly SolutionDefaultSentinel = '__solutionDefault__'
    // Minor 3: a decoded child id must carry a real connection id suffix. An empty suffix
    // means the command id was corrupted — fail loudly rather than silently treating it as
    // the solution-default pick.
    private static readonly EmptyActiveChildIdMessage = 'ConnectionActionsContributor: malformed active-connection child id'

    private static readonly NewLabel = 'New Connection…'
    private static readonly EditLabel = 'Edit…'
    private static readonly TestLabel = 'Test'
    private static readonly MakeDefaultLabel = 'Make Default'
    private static readonly MakeSolutionDefaultLabel = 'Make Solution Default'
    private static readonly RemoveLabel = 'Remove'
    private static readonly ActiveLabel = 'Active connection'

    public readonly ParentKeys = [NodeKey.Connections]
    public readonly Order = 10

    // The Connections-branch CommandDefinitions, Context-tagged per node family. The active
    // row's submenu names ConnectionActiveSubmenuContributor as its lazy ChildrenContributor.
    // Passed to RegisterInstance(this, this.Actions) at rebuild() — the runtime-dep
    // (IConnectionView + launcher) ctor keeps this off the module DSL path.
    public readonly Actions: readonly CommandDefinition[]

    constructor(private readonly view: IConnectionView, private readonly launcher: IConnectionEditorLauncher)
    {
        const active = ConnectionActionsContributor.command(ConnectionActionsContributor.ActiveId, ConnectionActionsContributor.ActiveLabel, NodeKey.Connections)
        active.Context = HierarchyContext.For(ConnectionNodeKey.Active)
        active.ChildrenContributor = ConnectionActiveSubmenuContributor.Key
        this.Actions = [
            ConnectionActionsContributor.command(ConnectionActionsContributor.NewId, ConnectionActionsContributor.NewLabel, NodeKey.Connections),
            ConnectionActionsContributor.command(ConnectionActionsContributor.EditId, ConnectionActionsContributor.EditLabel, ConnectionNodeKey.Leaf),
            ConnectionActionsContributor.command(ConnectionActionsContributor.TestId, ConnectionActionsContributor.TestLabel, ConnectionNodeKey.Leaf),
            ConnectionActionsContributor.command(ConnectionActionsContributor.MakeDefaultId, ConnectionActionsContributor.MakeDefaultLabel, ConnectionNodeKey.Leaf),
            ConnectionActionsContributor.command(ConnectionActionsContributor.MakeSolutionDefaultId, ConnectionActionsContributor.MakeSolutionDefaultLabel, ConnectionNodeKey.Leaf),
            ConnectionActionsContributor.command(ConnectionActionsContributor.RemoveId, ConnectionActionsContributor.RemoveLabel, ConnectionNodeKey.Leaf),
            active,
        ]
    }

    private static command(id: string, title: string, contextKey: string): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Context = HierarchyContext.For(contextKey)
        return def
    }

    // No node production — the connection rows are the ConnectionsProvider's.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const ctx = context as HierarchyActionContext
        const anchor = ctx.Anchor

        if (commandId.startsWith(ConnectionActionsContributor.ActiveCurrentChildPrefix))
        {
            // The current pick: re-selectable but gated off (it is already active).
            return new RelayCommand(() => {}, () => false)
        }
        if (commandId.startsWith(ConnectionActionsContributor.ActiveChildPrefix))
        {
            return this.activeChildCommand(commandId, anchor)
        }

        switch (commandId)
        {
            case ConnectionActionsContributor.NewId:
                return new RelayCommand(() => this.launcher.OpenNew())
            case ConnectionActionsContributor.EditId:
                return new RelayCommand(() => this.launcher.OpenEdit((anchor.ExtObject as LeafData).id))
            case ConnectionActionsContributor.TestId:
                return new RelayCommand(() => void this.view.TestConnection((anchor.ExtObject as LeafData).id))
            case ConnectionActionsContributor.MakeDefaultId:
            {
                const leaf = anchor.ExtObject as LeafData
                return new RelayCommand(() => void this.view.SetDefault(leaf.id), () => !leaf.isDefault)
            }
            case ConnectionActionsContributor.MakeSolutionDefaultId:
            {
                const leaf = anchor.ExtObject as LeafData
                return new RelayCommand(() => void this.view.SetSolutionDefault(leaf.id), () => !leaf.isSolutionDefault)
            }
            case ConnectionActionsContributor.RemoveId:
                return new RelayCommand(() => void this.removeFrom(ctx))
            case ConnectionActionsContributor.ActiveId:
                return new RelayCommand(() => {})
            default:
                return ConnectionActiveSubmenuContributor.PlaceholderCommand(commandId)
        }
    }

    private activeChildCommand(commandId: string, anchor: HierarchyItem): ICommand | undefined
    {
        const member = FileTreeContributor.MemberOf(anchor)
        if (member === undefined) return undefined
        const connId = commandId.slice(ConnectionActionsContributor.ActiveChildPrefix.length)
        if (connId.length === 0)
        {
            throw new Error(`${ConnectionActionsContributor.EmptyActiveChildIdMessage}: "${commandId}"`)
        }
        const target = connId === ConnectionActionsContributor.SolutionDefaultSentinel ? undefined : connId
        return new RelayCommand(() => void this.view.SetActiveConnectionFor(member, target))
    }

    // Selection-aware Remove: when the anchor is part of the live selection, remove every
    // selected connection leaf; otherwise just the anchor.
    private async removeFrom(context: HierarchyActionContext): Promise<void>
    {
        const anchor = context.Anchor
        const leaves = context.Selection.filter((vm) => vm.Key === ConnectionNodeKey.Leaf)
        const targets = leaves.includes(anchor) && leaves.length > 0 ? leaves : [anchor]
        for (const vm of targets)
        {
            await this.view.RemoveConnection((vm.ExtObject as LeafData).id)
        }
    }
}

// Supplies the "Active connection ▸" submenu rows lazily: a "(solution default)" row plus
// one row per connection, marking the current pick. The lists are I/O (async) while
// ICommandContributor.Contribute is synchronous, so each member's rows are fetched
// fire-and-forget into a cache and the snapshot is returned; the rows populate on the next
// open. Row behaviour is dispatched by ConnectionActionsContributor.
export class ConnectionActiveSubmenuContributor implements ICommandContributor
{
    public static readonly Key = new ServiceKey<ConnectionActiveSubmenuContributor>('ConnectionActiveSubmenuContributor')

    private static readonly SolutionDefaultLabel = '(solution default)'
    private static readonly NoConnectionsLabel = '(no connections)'
    private static readonly LoadingLabel = 'Loading…'
    private static readonly EmptyId = 'connection.active.empty'
    private static readonly LoadingId = 'connection.active.loading'
    // Minor 3: a real connection id that collided with the sentinel would be silently
    // treated as "use solution default" by ConnectionActionsContributor.activeChildCommand.
    // Fail loudly instead — this should never fire for real connection ids.
    private static readonly SentinelCollisionMessage = 'ConnectionActiveSubmenuContributor: a connection id collides with the solution-default sentinel'
    private static readonly Placeholder = new LazySubmenuPlaceholder(ConnectionActiveSubmenuContributor.LoadingId, ConnectionActiveSubmenuContributor.EmptyId)

    private readonly cache = new Map<SolutionMember, readonly CommandDefinition[]>()

    constructor(private readonly view: IConnectionView)
    {
    }

    public Contribute(_parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[]
    {
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return []
        const hit = this.cache.get(member)
        if (hit !== undefined) return hit
        void (async () =>
        {
            try
            {
                const [connections, current] = await Promise.all([this.view.ConnectionsView(), this.view.ActiveConnectionFor(member)])
                this.cache.set(member, this.rows(connections.map((c) => ({ id: c.Id, label: c.DisplayName })), current?.Id))
            }
            catch
            {
                this.cache.set(member, [])
            }
        })()
        return [ConnectionActiveSubmenuContributor.Placeholder.LoadingRow(ConnectionActiveSubmenuContributor.LoadingLabel)]
    }

    private rows(connections: readonly { id: string; label: string }[], currentId: string | undefined): readonly CommandDefinition[]
    {
        const out: CommandDefinition[] = [ConnectionActiveSubmenuContributor.row(
            ConnectionActionsContributor.ActiveChildPrefix + ConnectionActionsContributor.SolutionDefaultSentinel,
            ConnectionActiveSubmenuContributor.SolutionDefaultLabel)]
        if (connections.length === 0)
        {
            out.push(ConnectionActiveSubmenuContributor.Placeholder.EmptyRow(ConnectionActiveSubmenuContributor.NoConnectionsLabel))
            return out
        }
        for (const c of connections)
        {
            if (c.id === ConnectionActionsContributor.SolutionDefaultSentinel)
            {
                throw new Error(`${ConnectionActiveSubmenuContributor.SentinelCollisionMessage}: "${c.id}"`)
            }
            const id = c.id === currentId
                ? ConnectionActionsContributor.ActiveCurrentChildPrefix + c.id
                : ConnectionActionsContributor.ActiveChildPrefix + c.id
            out.push(ConnectionActiveSubmenuContributor.row(id, c.label))
        }
        return out
    }

    private static row(id: string, title: string): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        return def
    }

    public static PlaceholderCommand(commandId: string): ICommand | undefined
    {
        return ConnectionActiveSubmenuContributor.Placeholder.CommandFor(commandId)
    }
}

export default ConnectionActionsContributor
