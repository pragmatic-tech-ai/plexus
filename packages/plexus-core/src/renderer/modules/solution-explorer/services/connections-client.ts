/**
 * `IConnectionsClient` — the renderer-side seam over the main-process connection authority
 * (the `connections:*` IPC surface). Lives in plexus-core so `ConnectionEditingService` can
 * depend on it without plexus-core depending on an app; apps/plexus provides the concrete
 * implementation over `window.api.connections`. Connection *types* come from the
 * browser-safe todl subpath — no fs/network/secrets reach the renderer, and a token is
 * never returned (only `ConnectionView.HasToken`).
 */
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { ConnectionView, ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager/connections'

export interface ConnectionTestResult
{
    readonly ok: boolean
    readonly message?: string
}

export interface IConnectionsClient
{
    List(): Promise<readonly ConnectionView[]>
    Add(spec: ConnectionSpec): Promise<ConnectionView>
    Update(id: string, partial: Partial<ConnectionSpec>): Promise<ConnectionView | undefined>
    Remove(id: string): Promise<void>
    SetToken(id: string, token: string): Promise<void>
    UseEnvToken(id: string, varName: string): Promise<void>
    SetDefault(id: string): Promise<void>
    Test(id: string): Promise<ConnectionTestResult>
    EnvVars(): Promise<readonly string[]>
}

// DI token the connection consumers (ConnectionEditingService, via ProjectExplorerService)
// resolve the client under; apps/plexus registers a concrete impl over window.api.connections.
export const ConnectionsClientKey = new ServiceKey<IConnectionsClient>('IConnectionsClient')
