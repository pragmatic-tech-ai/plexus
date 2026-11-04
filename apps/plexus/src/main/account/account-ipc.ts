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
    private static readonly UnexpectedLog = '[account] request failed:'
    private static readonly PushFailedLog = '[account] could not push the account state to a window:'

    public static Register(ipc: IpcMain, service: AccountService, renderers: () => readonly IAccountChangeSink[]): IDisposable
    {
        ipc.handle(AccountChannel.State, () => AccountWire.Capture(() => service.State(), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.Discover, (_e, platformUrl: unknown, email: unknown) => AccountWire.Capture(async () =>
            service.Discover(AccountIpc.Text(platformUrl), AccountIpc.Text(email)), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.SignIn, (_e, platformUrl: unknown, email: unknown, tenantId: unknown) => AccountWire.Capture(async () =>
            service.SignIn(AccountIpc.Text(platformUrl), AccountIpc.Text(email), AccountIpc.Text(tenantId)), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.CancelSignIn, () => AccountWire.Capture(() => service.CancelSignIn(), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.SignOut, () => AccountWire.Capture(() => service.SignOut(), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.Targets, () => AccountWire.Capture(() => service.Targets(), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.LastChoice, (_e, kind: unknown) => AccountWire.Capture(async () => service.LastChoice(AccountIpc.Kind(kind)), AccountIpc.LogUnexpected))
        ipc.handle(AccountChannel.RememberChoice, (_e, kind: unknown, choice: unknown) => AccountWire.Capture(async () =>
            service.RememberChoice(AccountIpc.Kind(kind), AccountIpc.Choice(choice)), AccountIpc.LogUnexpected))
        return service.Changed.subscribe(state =>
        {
            for (const renderer of renderers())
            {
                // One window failing (closing mid-push) must not fail the change that raised it.
                try
                {
                    if (!renderer.isDestroyed()) renderer.send(AccountChannel.Changed, state)
                }
                catch (e)
                {
                    console.error(AccountIpc.PushFailedLog, AccountIpc.Describe(e))
                }
            }
        })
    }

    // Logs only the error's name and code: a message can carry a path or an address.
    private static LogUnexpected(error: unknown): void
    {
        console.error(AccountIpc.UnexpectedLog, AccountIpc.Describe(error))
    }

    private static Describe(error: unknown): { name?: string; code?: string }
    {
        if (typeof error !== 'object' || error === null) return {}
        const { name, code } = error as { name?: unknown; code?: unknown }
        return { name: typeof name === 'string' ? name : undefined, code: typeof code === 'string' ? code : undefined }
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
