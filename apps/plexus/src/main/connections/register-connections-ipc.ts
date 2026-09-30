/**
 * Registers the `connections:*` IPC handlers, each a thin bind from a `ConnectionChannel`
 * to a `ConnectionsBridge` method. Renderer -> main via `ipcRenderer.invoke`; the bridge
 * drives the TODL engine. Tokens are set (write-only) here and never returned.
 */
import { ipcMain } from 'electron'
import type { ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager'
import { ConnectionChannel } from '../../shared/connections-api.js'
import type { ConnectionsBridge } from './connections-bridge.js'

export class ConnectionsIpc
{
    public static Register(bridge: ConnectionsBridge): void
    {
        ipcMain.handle(ConnectionChannel.List, () => bridge.List())
        ipcMain.handle(ConnectionChannel.Add, (_e, spec: ConnectionSpec) => bridge.Add(spec))
        ipcMain.handle(ConnectionChannel.Update, (_e, id: string, partial: Partial<ConnectionSpec>) => bridge.Update(id, partial))
        ipcMain.handle(ConnectionChannel.Remove, (_e, id: string) => bridge.Remove(id))
        ipcMain.handle(ConnectionChannel.SetToken, (_e, id: string, token: string) => bridge.SetToken(id, token))
        ipcMain.handle(ConnectionChannel.UseEnvToken, (_e, id: string, varName: string) => bridge.UseEnvToken(id, varName))
        ipcMain.handle(ConnectionChannel.SetDefault, (_e, id: string) => bridge.SetDefault(id))
        ipcMain.handle(ConnectionChannel.Test, (_e, id: string) => bridge.Test(id))
        ipcMain.handle(ConnectionChannel.EnvVars, () => bridge.EnvVars())
    }
}
