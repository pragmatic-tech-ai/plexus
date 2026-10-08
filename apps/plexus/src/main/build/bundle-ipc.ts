import type { IpcMain } from 'electron'
import type { IBundler, BundleAppRequest } from '@pragmatic-tech-ai/todl/build-system-core'
import { BundleChannel } from '@pragmatic-tech-ai/plexus-core/shared/bundle-api.js'

/** Wires the bundler IPC handler in the Electron main process. */
export class BundleIpc
{
    public static Register(ipc: IpcMain, bundler: IBundler): void
    {
        ipc.handle(BundleChannel.Bundle, (_event, request: BundleAppRequest) => bundler.BundleApp(request))
    }
}
