import type { IpcMain } from 'electron'
import { RelayWire } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TenantPublishChannel } from '../../shared/tenant-publish-api.js'
import type { TenantDeployService } from './tenant-deploy-service.js'

// Binds the tenant-publish IPC channel. The handler answers a RelayReply envelope so the failure
// sentence (and an account kind) reaches the renderer intact. Renderer arguments are checked before
// they reach the service.
export class TenantPublishIpc
{
    private static readonly BadArguments = 'The publish request was malformed.'

    public static Register(ipc: IpcMain, deploy: Pick<TenantDeployService, 'Deploy'>): void
    {
        ipc.handle(TenantPublishChannel.Deploy, (_e, environment: unknown, outputDir: unknown) => RelayWire.Capture(async () =>
            deploy.Deploy(TenantPublishIpc.Text(environment), TenantPublishIpc.Text(outputDir))))
    }

    private static Text(value: unknown): string
    {
        if (typeof value !== 'string' || value.trim() === '') throw new TypeError(TenantPublishIpc.BadArguments)
        return value
    }
}
