import type { IpcMain } from 'electron'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevSessionChannel } from '../../shared/dev-session-api.js'
import type { DevSessionHost } from './dev-session-host.js'

// The slice of a renderer's WebContents the Changed push needs (Electron's WebContents satisfies it).
export interface IDevSessionChangeSink
{
    send(channel: string, ...args: unknown[]): void;
    isDestroyed(): boolean;
}

// Binds the develop-session IPC channels. Every handler answers a RelayReply envelope so the failure
// sentence reaches the renderer intact; renderer arguments are checked before they reach the session.
// The session's storage changes are pushed to every renderer on DevSessionChannel.Changed.
export class DevSessionIpc
{
    private static readonly BadArguments = 'The development session request was malformed.'
    private static readonly PushFailedLog = '[dev-session] could not push a storage change to a window:'

    public static Register(ipc: IpcMain, host: DevSessionHost, renderers: () => readonly IDevSessionChangeSink[]): IDisposable
    {
        ipc.handle(DevSessionChannel.Open, (_e, target: unknown) => RelayWire.Capture(() => host.Open(DevSessionIpc.Target(target))))
        ipc.handle(DevSessionChannel.Close, () => RelayWire.Capture(() => host.Close()))
        ipc.handle(DevSessionChannel.ReadText, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.ReadText(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.ReadBytes, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.ReadBytes(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.WriteText, (_e, path: unknown, content: unknown) => RelayWire.Capture(async () =>
            host.Session.WriteText(DevSessionIpc.Text(path), DevSessionIpc.Text(content))))
        ipc.handle(DevSessionChannel.WriteBytes, (_e, path: unknown, bytes: unknown) => RelayWire.Capture(async () =>
            host.Session.WriteBytes(DevSessionIpc.Text(path), DevSessionIpc.Bytes(bytes))))
        ipc.handle(DevSessionChannel.Exists, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.Exists(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.Delete, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.Delete(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.CreateDirectory, (_e, path: unknown) => RelayWire.Capture(async () => host.Session.CreateDirectory(DevSessionIpc.Text(path))))
        ipc.handle(DevSessionChannel.Rename, (_e, from: unknown, to: unknown) => RelayWire.Capture(async () =>
            host.Session.Rename(DevSessionIpc.Text(from), DevSessionIpc.Text(to))))
        ipc.handle(DevSessionChannel.List, (_e, path: unknown) => RelayWire.Capture(async () => [...await host.Session.List(DevSessionIpc.Text(path))]))
        const off = host.OnChanged(change =>
        {
            for (const renderer of renderers())
            {
                // One window failing (closing mid-push) must not fail the change that raised it.
                try
                {
                    if (!renderer.isDestroyed()) renderer.send(DevSessionChannel.Changed, change)
                }
                catch (e)
                {
                    console.error(DevSessionIpc.PushFailedLog, e instanceof Error ? e.name : typeof e)
                }
            }
        })
        return { dispose: off }
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(DevSessionIpc.BadArguments)
        return target
    }

    private static Text(value: unknown): string
    {
        if (typeof value !== 'string') throw new TypeError(DevSessionIpc.BadArguments)
        return value
    }

    private static Bytes(value: unknown): Uint8Array
    {
        if (!(value instanceof Uint8Array)) throw new TypeError(DevSessionIpc.BadArguments)
        return value
    }
}
