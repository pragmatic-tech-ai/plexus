import type { IpcMain } from 'electron'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TenantPublishChannel } from '../../shared/tenant-publish-api.js'
import type { TenantDeployService } from './tenant-deploy-service.js'

// Binds the tenant-publish IPC channel. The handler answers a RelayReply envelope so the failure
// sentence (and an account kind) reaches the renderer intact. Renderer arguments are checked before
// they reach the service: the target must be { Name, Source } with a known source, and only those
// two fields are handed on.
export class TenantPublishIpc
{
    private static readonly BadArguments = 'The publish request was malformed.'

    public static Register(ipc: IpcMain, deploy: Pick<TenantDeployService, 'Deploy'>): void
    {
        ipc.handle(TenantPublishChannel.Deploy, (_e, target: unknown, outputDir: unknown) => RelayWire.Capture(async () =>
            deploy.Deploy(TenantPublishIpc.Target(target), TenantPublishIpc.Text(outputDir))))
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(TenantPublishIpc.BadArguments)
        return target
    }

    private static Text(value: unknown): string
    {
        if (typeof value !== 'string' || value.trim() === '') throw new TypeError(TenantPublishIpc.BadArguments)
        return value
    }
}
