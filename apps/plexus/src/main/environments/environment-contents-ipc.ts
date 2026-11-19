import type { IpcMain } from 'electron'
import type { PageParams } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentsChannel, type EnvironmentCypherParams } from '../../shared/environment-contents-api.js'
import type { EnvironmentContentsService } from './environment-contents-service.js'

// Binds the environment-contents IPC channel. The handler answers a RelayReply envelope so the failure
// sentence (and an account kind) reaches the renderer intact. The target is checked before it reaches
// the service: it must be { Name, Source } with a known source, and only those two fields are handed on.
export class EnvironmentContentsIpc
{
    private static readonly BadArguments = 'The environment request was malformed.'

    private static readonly BadCypher = 'The graph query was malformed.'

    public static Register(ipc: IpcMain, service: Pick<EnvironmentContentsService, 'Contents' | 'Cypher'>): void
    {
        ipc.handle(EnvironmentsChannel.Contents, (_e, target: unknown) => RelayWire.Capture(async () =>
            service.Contents(EnvironmentContentsIpc.Target(target))))
        ipc.handle(EnvironmentsChannel.Cypher, (_e, target: unknown, cypher: unknown, params: unknown, page: unknown) => RelayWire.Capture(async () =>
            service.Cypher(
                EnvironmentContentsIpc.Target(target),
                EnvironmentContentsIpc.CypherText(cypher),
                params as EnvironmentCypherParams | undefined,
                page as PageParams | undefined)))
    }

    private static CypherText(value: unknown): string
    {
        if (typeof value !== 'string') throw new TypeError(EnvironmentContentsIpc.BadCypher)
        return value
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(EnvironmentContentsIpc.BadArguments)
        return target
    }
}
