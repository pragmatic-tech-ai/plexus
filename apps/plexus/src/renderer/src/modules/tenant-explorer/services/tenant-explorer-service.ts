import {
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import type { IActivatable } from '@pragmatic-tech-ai/mural/framework'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey } from '@pragmatic-tech-ai/plexus-core/renderer/modules/account'
import {
    TargetStatus, type EnvironmentTarget, type TargetRef,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentsApiKey } from '../../../services/environments/environments-contents-source.js'
import { TenantExplorerNode } from './tenant-explorer-node.js'

// The bindable property names this service raises PropertyChanged for.
export enum TenantExplorerProperty
{
    SignedIn = 'SignedIn',
    IsEmpty = 'IsEmpty',
}

// The Tenant Explorer panel's content service: the signed-in tenant as a root node with its
// environments (the union of the contribute and publish targets) beneath it. Each environment
// loads its applications and graphs lazily on first expand, through the main process's relay.
export class TenantExplorerService extends ServiceBase implements IActivatable
{
    public static readonly Key = new ServiceKey<TenantExplorerService>('TenantExplorerService')

    private static readonly FallbackTenantLabel = 'Tenant'
    private static readonly NothingDeployed = 'Nothing deployed'
    private static readonly Unavailable = 'Environment contents are not available right now.'
    private static readonly GenericFailure = 'The environment could not be read. Try again.'
    private static readonly StatusLabels: Readonly<Record<TargetStatus, string>> = {
        [TargetStatus.Running]: 'Running',
        [TargetStatus.Stopped]: 'Stopped',
        [TargetStatus.Failed]: 'Failed',
        [TargetStatus.Unknown]: 'Unknown',
    }

    private readonly _nodes = new ObservableCollection<TenantExplorerNode>()
    private readonly accountChanged: IDisposable | undefined
    private _signedIn = false
    private _isEmpty = false
    // Bumped each reload; a slower earlier reload whose seq is stale is discarded.
    private reloadSeq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.accountChanged = provider.get(AccountServiceKey)?.Changed.subscribe(() => { void this.reload() })
        void this.reload()
    }

    public get Nodes(): ObservableCollection<TenantExplorerNode> { return this._nodes }
    public get SignedIn(): boolean { return this._signedIn }
    public get IsEmpty(): boolean { return this._isEmpty }

    // IActivatable: re-read whenever this panel becomes the active capability.
    public OnActivated(): void { void this.reload() }

    public override dispose(): void
    {
        this.accountChanged?.dispose()
        super.dispose()
    }

    private async reload(): Promise<void>
    {
        const seq = ++this.reloadSeq
        const account = this.Provider.get(AccountServiceKey)
        if (account === undefined || !account.State.SignedIn)
        {
            this._nodes.Clear()
            this.SetFlags(false, false)
            return
        }
        const tenantName = account.State.TenantName
        const targets = await account.Targets()
        if (seq !== this.reloadSeq) return   // a newer reload superseded this one

        const unioned = new Map<string, EnvironmentTarget>()
        for (const t of [...targets.Contribute, ...targets.Publish]) unioned.set(t.Id, t)
        const envs = [...unioned.values()].sort((a, b) => a.Name.localeCompare(b.Name))

        const root = TenantExplorerNode.Tenant(tenantName ?? TenantExplorerService.FallbackTenantLabel)
        for (const t of envs)
        {
            root.Children.Add(TenantExplorerNode.Environment(
                t.Name,
                TenantExplorerService.StatusLabel(t.Status),
                () => this.LoadContents({ Name: t.Name, Source: t.Source }),
            ))
        }
        this._nodes.Clear()
        this._nodes.Add(root)
        this.SetFlags(true, envs.length === 0)
    }

    private async LoadContents(target: TargetRef): Promise<TenantExplorerNode[]>
    {
        const api = this.Provider.get(EnvironmentsApiKey)
        if (api === undefined) return [TenantExplorerNode.Message(TenantExplorerService.Unavailable)]
        try
        {
            const contents = await api.Contents(target)
            const nodes = [
                ...contents.Applications.map((a) => TenantExplorerNode.Application(`${a.Name} ${a.Version}`)),
                ...contents.Graphs.map((g) => TenantExplorerNode.Graph(g.Name)),
            ]
            return nodes.length > 0 ? nodes : [TenantExplorerNode.Message(TenantExplorerService.NothingDeployed)]
        }
        catch (e)
        {
            return [TenantExplorerNode.Message(TenantExplorerService.SentenceOf(e))]
        }
    }

    private SetFlags(signedIn: boolean, isEmpty: boolean): void
    {
        const wasSignedIn = this._signedIn
        const wasEmpty = this._isEmpty
        this._signedIn = signedIn
        this._isEmpty = isEmpty
        if (wasSignedIn !== signedIn) this.RaisePropertyChanged(TenantExplorerProperty.SignedIn, wasSignedIn, signedIn)
        if (wasEmpty !== isEmpty) this.RaisePropertyChanged(TenantExplorerProperty.IsEmpty, wasEmpty, isEmpty)
    }

    private static StatusLabel(status: TargetStatus): string
    {
        return TenantExplorerService.StatusLabels[status] ?? TenantExplorerService.StatusLabels[TargetStatus.Unknown]
    }

    private static SentenceOf(e: unknown): string
    {
        return e instanceof Error ? e.message : TenantExplorerService.GenericFailure
    }
}
