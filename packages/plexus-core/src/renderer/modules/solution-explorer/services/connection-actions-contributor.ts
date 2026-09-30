import {
    HierarchyAction, NodeKey,
    type IHierarchyActionContributor, type HierarchyActionContext, type HierarchyItemVM,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import { ConnectionNodeKey } from './connection-node-key.js'
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

// The identity a connection leaf carries as its Data.
interface LeafData
{
    readonly id: string
    readonly isDefault: boolean
}

// Contributes the Connections-branch context-menu actions, routed to IConnectionView + the
// editor launcher. The Connections node offers New Connection…; a leaf offers Edit… / Test /
// Make Default (non-executable when already default) / a selection-aware Remove; the
// per-project active-connection row offers an Active connection ▸ submenu (the current pick
// non-executable) plus a "(solution default)" entry.
export class ConnectionActionsContributor implements IHierarchyActionContributor
{
    private static readonly NewLabel = 'New Connection…'
    private static readonly EditLabel = 'Edit…'
    private static readonly TestLabel = 'Test'
    private static readonly MakeDefaultLabel = 'Make Default'
    private static readonly RemoveLabel = 'Remove'
    private static readonly ActiveLabel = 'Active connection'
    private static readonly SolutionDefaultLabel = '(solution default)'
    private static readonly NoConnectionsLabel = '(no connections)'

    public readonly ActionKeys = [NodeKey.Connections, ConnectionNodeKey.Leaf, ConnectionNodeKey.Active]

    constructor(private readonly view: IConnectionView, private readonly launcher: IConnectionEditorLauncher)
    {
    }

    public ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]
    {
        const anchor = context.Anchor
        switch (anchor.Key)
        {
            case NodeKey.Connections:
                return [HierarchyAction.Command(ConnectionActionsContributor.NewLabel, () => this.launcher.OpenNew())]
            case ConnectionNodeKey.Leaf:
            {
                const leaf = anchor.Data as LeafData
                return [
                    HierarchyAction.Command(ConnectionActionsContributor.EditLabel, () => this.launcher.OpenEdit(leaf.id)),
                    HierarchyAction.Command(ConnectionActionsContributor.TestLabel, () => void this.view.TestConnection(leaf.id)),
                    HierarchyAction.Command(ConnectionActionsContributor.MakeDefaultLabel, () => void this.view.SetDefault(leaf.id), { canExecute: () => !leaf.isDefault }),
                    this.removeAction(context),
                ]
            }
            case ConnectionNodeKey.Active:
            {
                const member = FileTreeContributor.MemberOf(anchor)
                return member !== undefined ? [this.activeAction(member)] : []
            }
            default:
                return []
        }
    }

    private removeAction(context: HierarchyActionContext): HierarchyAction
    {
        return HierarchyAction.Command(ConnectionActionsContributor.RemoveLabel, (ctx) => void this.removeFrom(ctx), { context })
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
            await this.view.RemoveConnection((vm.Data as LeafData).id)
        }
    }

    private activeAction(member: SolutionMember): HierarchyAction
    {
        const action = HierarchyAction.Command(ConnectionActionsContributor.ActiveLabel, () => {})
        void (async () =>
        {
            const [connections, current] = await Promise.all([this.view.ConnectionsView(), this.view.ActiveConnectionFor(member)])
            action.Children.Add(HierarchyAction.Command(
                ConnectionActionsContributor.SolutionDefaultLabel,
                () => void this.view.SetActiveConnectionFor(member, undefined)))
            if (connections.length === 0)
            {
                action.Children.Add(HierarchyAction.Command(ConnectionActionsContributor.NoConnectionsLabel, () => {}, { canExecute: () => false }))
                return
            }
            for (const c of connections)
            {
                action.Children.Add(HierarchyAction.Command(
                    c.DisplayName,
                    () => void this.view.SetActiveConnectionFor(member, c.Id),
                    { canExecute: () => current?.Id !== c.Id }))
            }
        })()
        return action
    }
}
