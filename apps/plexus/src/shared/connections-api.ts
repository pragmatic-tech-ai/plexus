// Wire contract for the connections feature: the renderer<->main IPC channel names and the
// renderer-facing bridge shape (exposed on window.api.connections by the preload). The
// bridge shape IS plexus-core's IConnectionsClient — the renderer service consumes that
// interface, so we re-export it here as the api contract rather than duplicating it.
// Connection data types come from the browser-safe todl subpath; a token never crosses.
export type { IConnectionsClient as IConnectionsApi, ConnectionTestResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'

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
    EnvVars    = 'connections:env-vars',
}
