import type { IpcMain } from 'electron'
import { TenantPublishChannel } from '../../shared/tenant-publish-api.js'
import type { TenantDeployService } from './tenant-deploy-service.js'
import type { TenantProfileStore } from './tenant-profile-store.js'

// Binds the tenant-publish IPC channels. The token is write-only: SetProfile stores it,
// HasProfile reports only whether one is configured.
export class TenantPublishIpc
{
    public static Register(ipc: IpcMain, deploy: TenantDeployService, profiles: TenantProfileStore): void
    {
        ipc.handle(TenantPublishChannel.Deploy, (_e, outputDir: string) => deploy.Deploy(outputDir))
        ipc.handle(TenantPublishChannel.SetProfile, (_e, serverUrl: string, token: string) => profiles.Save(serverUrl, token))
        ipc.handle(TenantPublishChannel.HasProfile, async () => (await profiles.Load()) !== undefined)
    }
}
