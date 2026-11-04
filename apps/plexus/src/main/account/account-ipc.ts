import type { IpcMain } from 'electron'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { AccountChannel, AccountWire, TargetKind, type TargetChoice } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { AccountService } from './account-service.js'

// The slice of a renderer's WebContents the Changed push needs (Electron's WebContents satisfies it).
export interface IAccountChangeSink
{
    send(channel: string, ...args: unknown[]): void;
    isDestroyed(): boolean;
}

// Binds the account IPC channels. Every handler answers an AccountReply envelope so an AccountError
// crosses as its kind only; the session token is never part of any answer. Renderer arguments are
// checked before they reach the service.
export class AccountIpc
{
    private static readonly BadArguments = 'The account request was malformed.'

    public static Register(ipc: IpcMain, service: AccountService, renderers: () => readonly IAccountChangeSink[]): IDisposable
    {
        ipc.handle(AccountChannel.State, () => AccountWire.Capture(() => service.State()))
        ipc.handle(AccountChannel.Discover, (_e, platformUrl: unknown, email: unknown) => AccountWire.Capture(async () =>
            service.Discover(AccountIpc.Text(platformUrl), AccountIpc.Text(email))))
        ipc.handle(AccountChannel.SignIn, (_e, platformUrl: unknown, email: unknown, tenantId: unknown) => AccountWire.Capture(async () =>
            service.SignIn(AccountIpc.Text(platformUrl), AccountIpc.Text(email), AccountIpc.Text(tenantId))))
        ipc.handle(AccountChannel.CancelSignIn, () => AccountWire.Capture(() => service.CancelSignIn()))
        ipc.handle(AccountChannel.SignOut, () => AccountWire.Capture(() => service.SignOut()))
        ipc.handle(AccountChannel.Targets, () => AccountWire.Capture(() => service.Targets()))
        ipc.handle(AccountChannel.LastChoice, (_e, kind: unknown) => AccountWire.Capture(async () => service.LastChoice(AccountIpc.Kind(kind))))
        ipc.handle(AccountChannel.RememberChoice, (_e, kind: unknown, choice: unknown) => AccountWire.Capture(async () =>
            service.RememberChoice(AccountIpc.Kind(kind), AccountIpc.Choice(choice))))
        return service.Changed.subscribe(state =>
        {
            for (const renderer of renderers())
            {
                if (!renderer.isDestroyed()) renderer.send(AccountChannel.Changed, state)
            }
        })
    }

    private static Text(value: unknown): string
    {
        if (typeof value !== 'string') throw new TypeError(AccountIpc.BadArguments)
        return value
    }

    private static Kind(value: unknown): TargetKind
    {
        if (!Object.values(TargetKind).includes(value as TargetKind)) throw new TypeError(AccountIpc.BadArguments)
        return value as TargetKind
    }

    private static Choice(value: unknown): TargetChoice
    {
        if (typeof value !== 'object' || value === null) throw new TypeError(AccountIpc.BadArguments)
        const { Environment, GraphName } = value as Record<string, unknown>
        if (typeof Environment !== 'string' || Environment === '') throw new TypeError(AccountIpc.BadArguments)
        if (GraphName !== undefined && typeof GraphName !== 'string') throw new TypeError(AccountIpc.BadArguments)
        return GraphName === undefined ? { Environment } : { Environment, GraphName }
    }
}
