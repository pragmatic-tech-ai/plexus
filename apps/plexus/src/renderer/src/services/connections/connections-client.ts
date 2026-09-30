import { ServiceBase, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ConnectionsClientKey, type IConnectionsClient, type ConnectionTestResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'
import type { ConnectionView, ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { IConnectionsApi } from '../../../../shared/connections-api.js'

// The renderer-side connections client: the concrete IConnectionsClient plexus-core's
// ConnectionEditingService resolves (through ProjectExplorerService). A thin wrapper over the
// preload bridge (window.api.connections) — the same pattern as FileSystemService over
// window.api.fs — so plexus-core stays host-agnostic. Registered under ConnectionsClientKey.
// Tokens are write-only: SetToken sends a secret, but no method ever returns one.
export class ConnectionsClient extends ServiceBase implements IConnectionsClient
{
    public static readonly Key = ConnectionsClientKey

    private readonly api: IConnectionsApi

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { connections?: IConnectionsApi } }).api
        if (bridge?.connections === undefined)
        {
            throw new Error(
                'ConnectionsClient: window.api.connections is unavailable — the Electron preload '
                + 'bridge did not load. This service requires a desktop host.',
            )
        }
        this.api = bridge.connections
    }

    public List(): Promise<readonly ConnectionView[]> { return this.api.List() }
    public Add(spec: ConnectionSpec): Promise<ConnectionView> { return this.api.Add(spec) }
    public Update(id: string, partial: Partial<ConnectionSpec>): Promise<ConnectionView | undefined> { return this.api.Update(id, partial) }
    public Remove(id: string): Promise<void> { return this.api.Remove(id) }
    public SetToken(id: string, token: string): Promise<void> { return this.api.SetToken(id, token) }
    public UseEnvToken(id: string, varName: string): Promise<void> { return this.api.UseEnvToken(id, varName) }
    public SetDefault(id: string): Promise<void> { return this.api.SetDefault(id) }
    public Test(id: string): Promise<ConnectionTestResult> { return this.api.Test(id) }
    public EnvVars(): Promise<readonly string[]> { return this.api.EnvVars() }
}

export default ConnectionsClient
