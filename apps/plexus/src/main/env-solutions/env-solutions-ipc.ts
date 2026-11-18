import type { IpcMain } from 'electron'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvSolutionsChannel } from '../../shared/env-solutions-api.js'
import type { EnvSolutionsService } from './env-solutions-service.js'

// Binds the env-solutions IPC channel. The handler answers a RelayReply envelope so the failure
// sentence reaches the renderer intact; the target must be { Name, Source } with a known source.
export class EnvSolutionsIpc
{
    private static readonly BadArguments = 'The solution listing request was malformed.'

    public static Register(ipc: IpcMain, service: Pick<EnvSolutionsService, 'ListSolutions'>): void
    {
        ipc.handle(EnvSolutionsChannel.ListSolutions, (_e, target: unknown) => RelayWire.Capture(async () =>
            service.ListSolutions(EnvSolutionsIpc.Target(target))))
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(EnvSolutionsIpc.BadArguments)
        return target
    }
}
