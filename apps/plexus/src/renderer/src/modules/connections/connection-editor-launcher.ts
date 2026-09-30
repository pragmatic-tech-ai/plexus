import { ServiceBase, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer/services/project-explorer-service.js'
import { ConnectionEditorLauncherKey, type IConnectionEditorLauncher } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connection-actions-contributor.js'
import { ConnectionsClientKey } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'
import type { IConnectionView } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connection-view.js'
import type { ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager/connections'
import { ConnectionEditorDialogModel, type ConnectionEditorResult } from './connection-editor-dialog-model.js'

// Opens the connection editor dialog and applies the result through the connection view — the
// app-side IConnectionEditorLauncher the ConnectionActionsContributor calls. It owns the dialog
// host (mural's DialogService) so the contributor stays UI-free. Edit seeds from the full
// ConnectionView (via the client's List), which carries Settings/TokenSource the decorated leaf
// view omits; Add/Update flow back through the view so the tree refreshes.
export class ConnectionEditorLauncher extends ServiceBase implements IConnectionEditorLauncher
{
    public static readonly Key = ConnectionEditorLauncherKey
    private static readonly NewTitle = 'New Connection'
    private static readonly EditTitle = 'Edit Connection'
    private static readonly DialogWidth = 460

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    public OpenNew(): void { void this.open(undefined) }
    public OpenEdit(connectionId: string): void { void this.open(connectionId) }

    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get connections(): IConnectionView { return this.Provider.getRequired(ProjectExplorerService.Key).Connections }

    private async open(id: string | undefined): Promise<void>
    {
        const existing = id === undefined ? undefined : (await this.Provider.getRequired(ConnectionsClientKey).List()).find((c) => c.Id === id)
        if (id !== undefined && existing === undefined) return   // removed between menu-open and click
        const vm = new ConnectionEditorDialogModel(existing, (r) => this.dialogs.Close(r))
        const title = existing === undefined ? ConnectionEditorLauncher.NewTitle : ConnectionEditorLauncher.EditTitle
        const result = await this.dialogs.Show<ConnectionEditorResult>({ Title: title, Content: vm, Width: ConnectionEditorLauncher.DialogWidth })
        if (result === undefined) return
        await this.apply(result)
    }

    // Add or update through the connection view (fires its change signal → tree refresh). The
    // env-var name / token source ride in the spec; a stored secret is applied separately on
    // edit (Add carries it inline), and a blank secret on edit leaves the existing token intact.
    private async apply(r: ConnectionEditorResult): Promise<void>
    {
        const base: Partial<ConnectionSpec> = { DisplayName: r.displayName, RegistryType: r.registryType, Settings: r.settings, TokenSource: r.tokenSource }
        if (r.tokenEnvVar !== undefined) base.TokenEnvVar = r.tokenEnvVar
        if (r.id === undefined)
        {
            await this.connections.AddConnection({ Id: '', ...base } as ConnectionSpec, r.secret)
        }
        else
        {
            await this.connections.UpdateConnection(r.id, base)
            if (r.secret !== undefined) await this.connections.SetToken(r.id, r.secret)
        }
    }
}

export default ConnectionEditorLauncher
