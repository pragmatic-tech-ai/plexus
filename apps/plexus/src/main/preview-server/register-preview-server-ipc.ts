import type { IpcMain } from 'electron'
import { PreviewServerChannel } from '../../shared/preview-server-api.js'
import type { PreviewServerManager } from './preview-server-manager.js'

// Binds the preview-server IPC channels to the shared PreviewServerManager. The one allowed
// top-level function here matches the existing register*Handlers convention in main; it is a
// thin wiring seam, not a reusable domain transform.
export function registerPreviewServerIpc(ipc: IpcMain, manager: PreviewServerManager): void
{
    ipc.handle(PreviewServerChannel.Start, (_e, root: string) => manager.Start(root))
    ipc.handle(PreviewServerChannel.Stop, (_e, root: string) => manager.Stop(root))
}
