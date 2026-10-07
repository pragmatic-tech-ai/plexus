// Wire contract for the connections feature: the renderer<->main IPC channel names and the
// renderer-facing bridge shape (exposed on window.api.connections by the preload). The
// management half IS plexus-core's IConnectionsClient (the renderer view service consumes
// that); the app api adds Resolve, used by the connection-aware package store for
// per-project reference resolution. Connection data types come from the browser-safe todl
// subpath; a token never crosses.
import type { IConnectionsClient } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'
import type { SourcedPackage } from '@pragmatic-tech-ai/todl'
export type { IConnectionsClient, ConnectionTestResult, ConnectionInspection } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'

export interface IConnectionsApi extends IConnectionsClient
{
    // Resolve a published package from a connection's registry (best-effort, undefined on
    // any failure) — the fallback the connection-aware package store uses on a local miss.
    Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>
}

// IPC channel names (renderer -> main via ipcRenderer.invoke).
export enum ConnectionChannel
{
    List       = 'connections:list',
    Add        = 'connections:add',
    Update     = 'connections:update',
    Remove     = 'connections:remove',
    SetToken   = 'connections:set-token',
    UseEnvToken = 'connections:use-env-token',
    SetDefault = 'connections:set-default',
    Test       = 'connections:test',
    Inspect    = 'connections:inspect',
    EnvVars    = 'connections:env-vars',
    Resolve    = 'connections:resolve',
}
