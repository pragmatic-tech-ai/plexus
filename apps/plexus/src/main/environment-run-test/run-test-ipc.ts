import type { IpcMain } from 'electron'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { RunTestChannel, type IRunTestApi } from '../../shared/run-test-api.js'

// Binds the run-test IPC channel. The handler answers a RelayReply envelope so the failure sentence
// (and an account kind) reaches the renderer intact. Renderer arguments are checked before they reach
// the service: the target must be { Name, Source } with a known source, and only those two fields are
// handed on.
export class RunTestIpc
{
    private static readonly BadArguments = 'The run/test request was malformed.'

    public static Register(ipc: IpcMain, api: IRunTestApi): void
    {
        ipc.handle(RunTestChannel.Run, (_e, target: unknown, outputDir: unknown) => RelayWire.Capture(async () =>
            api.Run(RunTestIpc.Target(target), RunTestIpc.Text(outputDir))))
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(RunTestIpc.BadArguments)
        return target
    }

    private static Text(value: unknown): string
    {
        if (typeof value !== 'string' || value.trim() === '') throw new TypeError(RunTestIpc.BadArguments)
        return value
    }
}
