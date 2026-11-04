import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import {
    AccountError, AccountErrorKind, PlatformAddress, TargetKind,
    type AccountState, type AccountTargets, type DiscoveredTenant, type TargetChoice,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { DesktopApiClient } from './desktop-api-client.js'
import type { DesktopSession, DesktopSessionStore } from './desktop-session-store.js'
import type { IRedirectReceiver } from './loopback-redirect-receiver.js'

// One sign-in attempt, tracked from its first step so a cancel at any point (discovery, Begin, the
// browser wait, Complete) stops it: Cancel marks it and cancels the receiver; the attempt checks the
// mark after every await and before opening the browser.
class SignInAttempt
{
    private cancelled = false

    public constructor(public readonly Receiver: IRedirectReceiver)
    {
    }

    public Cancel(): void
    {
        this.cancelled = true
        this.Receiver.Cancel()
    }

    public get Cancelled(): boolean
    {
        return this.cancelled
    }

    public Check(): void
    {
        if (this.cancelled) throw new AccountError(AccountErrorKind.Cancelled)
    }
}

// Last environment picked per action, per tenant: { [tenantId]: { contribute?, publish? } }.
type ChoiceFile = Record<string, Partial<Record<TargetKind, TargetChoice>>>

// The Plexus account, main-process side. Sign-in: discover the email's tenant on the platform, begin
// a sign-in on the tenant plane with a loopback redirect and a binding challenge, open the system
// browser, wait for the code on the loopback, complete with the binding verifier, store the desktop
// session encrypted. The token stays here: State() reports only email + tenant name, and every
// change is raised on Changed for the IPC layer to push. A SignedOut answer from the tenant plane
// (targets here, relay connects via HandleSignedOut) clears the session it was given for, and only
// that one: a late 401 for a session already replaced leaves the newer one alone.
export class AccountService
{
    private static readonly ChoicesFile = 'publish-choices.json'
    private static readonly TempSuffix = '.tmp'
    private static readonly NotFoundCode = 'ENOENT'
    private static readonly SecureScheme = 'https:'
    private static readonly CleartextScheme = 'http:'
    private static readonly StateParam = 'state'
    private static readonly VerifierBytes = 32
    private static readonly Sha256 = 'sha256'
    private static readonly Base64Url = 'base64url'
    private static readonly Utf8 = 'utf8'
    private static readonly JsonIndent = 2
    private static readonly SignedOutState: AccountState = { SignedIn: false }

    public readonly Changed = new Signal<AccountState>()
    private discovered: { PlatformUrl: string; Email: string; TenantPlaneUrl: string } | undefined
    private attempt: SignInAttempt | undefined
    // RememberChoice read-modify-writes run one at a time, so concurrent calls neither share a temp
    // file nor lose each other's update.
    private choiceWrites: Promise<void> = Promise.resolve()
    // Every read-compare-write of the stored session (a sign-in storing its session, a 401 clearing
    // the one it was for, a sign-out clearing) runs one at a time, so a stale 401 can never load the
    // old session, then clear the one a concurrent sign-in has just saved.
    private sessionWrites: Promise<void> = Promise.resolve()

    public constructor(
        private readonly store: DesktopSessionStore,
        private readonly choicesDir: string,
        private readonly client: DesktopApiClient,
        private readonly receivers: () => IRedirectReceiver,
        private readonly openExternal: (url: string) => Promise<void>,
    )
    {
    }

    public async State(): Promise<AccountState>
    {
        return AccountService.StateOf(await this.store.Load())
    }

    // Main-process only (the relay connector): the session including its token.
    public Session(): Promise<DesktopSession | undefined>
    {
        return this.store.Load()
    }

    public async Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>
    {
        const platform = AccountService.Platform(platformUrl)
        const address = email.trim()
        const found = await this.client.Discover(platform, address)
        if (PlatformAddress.Validate(found.TenantPlaneUrl) !== undefined) throw new AccountError(AccountErrorKind.Unavailable)
        this.discovered = { PlatformUrl: platform, Email: address, TenantPlaneUrl: found.TenantPlaneUrl }
        return found.Tenants
    }

    public async SignIn(platformUrl: string, email: string, tenantId: string): Promise<AccountState>
    {
        // Without secure storage the session could never be kept: say so before the browser opens.
        if (!this.store.CanStore()) throw new AccountError(AccountErrorKind.SecureStorageUnavailable)
        this.attempt?.Cancel()
        const attempt = new SignInAttempt(this.receivers())
        this.attempt = attempt
        const receiver = attempt.Receiver
        try
        {
            const address = email.trim()
            const plane = await this.TenantPlaneFor(AccountService.Platform(platformUrl), address)
            attempt.Check()
            const verifier = randomBytes(AccountService.VerifierBytes).toString(AccountService.Base64Url)
            const challenge = createHash(AccountService.Sha256).update(verifier).digest(AccountService.Base64Url)
            const { RedirectUri } = await receiver.Start()
            attempt.Check()
            const authorizeUrl = await this.client.Begin(plane, tenantId, RedirectUri, challenge)
            attempt.Check()
            const state = AccountService.StateIn(authorizeUrl)
            const code = receiver.WaitForCode(state)
            const [, received] = await Promise.all([this.openExternal(authorizeUrl), code])
            attempt.Check()
            const done = await this.client.Complete(plane, state, received, verifier)
            const session: DesktopSession = {
                TenantPlaneUrl: plane, Token: done.Token, Email: done.Email ?? address, TenantId: done.TenantId, TenantName: done.TenantName, ExpiresAt: done.ExpiresAt,
            }
            // Cancelled while Complete was in flight: the tenant plane already issued a session; end it
            // rather than leave a live token nobody holds. Past this point the sign-in is committed.
            if (attempt.Cancelled)
            {
                await this.EndQuietly(session)
                attempt.Check()
            }
            const previous = await this.Keep(session)
            if (previous !== undefined && previous.Token !== session.Token) await this.EndQuietly(previous)
            const signedIn = AccountService.StateOf(session)
            this.Changed.emit(signedIn)
            return signedIn
        }
        catch (e)
        {
            attempt.Check()
            throw e
        }
        finally
        {
            if (this.attempt === attempt) this.attempt = undefined
            await receiver.Close()
        }
    }

    public async CancelSignIn(): Promise<void>
    {
        this.attempt?.Cancel()
    }

    // Ends the session on the tenant plane when it can be reached; clears locally either way.
    public async SignOut(): Promise<AccountState>
    {
        const session = await this.store.Load()
        if (session !== undefined) await this.EndQuietly(session)
        await this.Serialised(() => this.Forget())
        return AccountService.StateOf(undefined)
    }

    // The tenant plane said the session holding `token` is over (expired, revoked, signed out
    // elsewhere). Cleared only while that session is still the stored one: a 401 that arrives after
    // a sign-out and a new sign-in belongs to the old session and must not end the new one.
    public HandleSignedOut(token: string): Promise<void>
    {
        return this.Serialised(async () =>
        {
            const current = await this.store.Load()
            if (current === undefined || current.Token !== token) return
            await this.Forget()
        })
    }

    public async Targets(): Promise<AccountTargets>
    {
        const session = await this.store.Load()
        if (session === undefined) throw new AccountError(AccountErrorKind.SignedOut)
        try
        {
            return await this.client.Targets(session)
        }
        catch (e)
        {
            if (e instanceof AccountError && e.Kind === AccountErrorKind.SignedOut) await this.HandleSignedOut(session.Token)
            throw e
        }
    }

    public async LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>
    {
        const session = await this.store.Load()
        if (session === undefined) return undefined
        const choice = (await this.ReadChoices())[session.TenantId]?.[kind]
        return AccountService.ValidChoice(choice) ? AccountService.CopyChoice(choice) : undefined
    }

    public RememberChoice(kind: TargetKind, choice: TargetChoice): Promise<void>
    {
        const write = this.choiceWrites.then(() => this.WriteChoice(kind, choice))
        this.choiceWrites = write.catch(() => undefined)
        return write
    }

    private async WriteChoice(kind: TargetKind, choice: TargetChoice): Promise<void>
    {
        const session = await this.store.Load()
        if (session === undefined) throw new AccountError(AccountErrorKind.SignedOut)
        const choices = await this.ReadChoices()
        choices[session.TenantId] = { ...choices[session.TenantId], [kind]: AccountService.CopyChoice(choice) }
        await fs.mkdir(this.choicesDir, { recursive: true })
        const target = join(this.choicesDir, AccountService.ChoicesFile)
        const temp = `${target}${AccountService.TempSuffix}`
        await fs.writeFile(temp, JSON.stringify(choices, null, AccountService.JsonIndent))
        await fs.rename(temp, target)
    }

    private async TenantPlaneFor(platform: string, email: string): Promise<string>
    {
        const known = this.discovered
        if (known !== undefined && known.PlatformUrl === platform && known.Email === email) return known.TenantPlaneUrl
        await this.Discover(platform, email)
        return this.discovered!.TenantPlaneUrl
    }

    // Stores a freshly issued session and returns the one it replaced. When it cannot be stored the
    // tenant plane has already issued it, so it is ended there before the failure is reported.
    private async Keep(session: DesktopSession): Promise<DesktopSession | undefined>
    {
        try
        {
            return await this.Serialised(async () =>
            {
                const previous = await this.store.Load()
                await this.store.Save(session)
                return previous
            })
        }
        catch (e)
        {
            await this.EndQuietly(session)
            throw e
        }
    }

    // Runs `work` after every earlier session write has settled; a failure reaches only its caller.
    private Serialised<T>(work: () => Promise<T>): Promise<T>
    {
        const run = this.sessionWrites.then(work)
        this.sessionWrites = run.then(() => undefined, () => undefined)
        return run
    }

    private async Forget(): Promise<void>
    {
        await this.store.Clear()
        this.Changed.emit(AccountService.StateOf(undefined))
    }

    private async EndQuietly(session: DesktopSession): Promise<void>
    {
        try
        {
            await this.client.SignOut(session)
        }
        catch
        {
            // unreachable or refused: the local copy is dropped regardless
        }
    }

    private async ReadChoices(): Promise<ChoiceFile>
    {
        let text: string
        try
        {
            text = await fs.readFile(join(this.choicesDir, AccountService.ChoicesFile), AccountService.Utf8)
        }
        catch (e)
        {
            if ((e as NodeJS.ErrnoException).code === AccountService.NotFoundCode) return {}
            throw e
        }
        try
        {
            const parsed: unknown = JSON.parse(text)
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as ChoiceFile : {}
        }
        catch
        {
            return {}
        }
    }

    private static Platform(platformUrl: string): string
    {
        if (PlatformAddress.Validate(platformUrl) !== undefined) throw new AccountError(AccountErrorKind.Unreachable)
        return platformUrl.trim()
    }

    // The state the browser will hand back is the one the tenant plane put in the authorize URL. Only
    // an http(s) URL is ever opened in the browser.
    private static StateIn(authorizeUrl: string): string
    {
        let url: URL
        try
        {
            url = new URL(authorizeUrl)
        }
        catch
        {
            throw new AccountError(AccountErrorKind.SignInFailed)
        }
        const state = url.searchParams.get(AccountService.StateParam)
        const scheme = url.protocol === AccountService.SecureScheme || url.protocol === AccountService.CleartextScheme
        if (!scheme || state === null || state === '') throw new AccountError(AccountErrorKind.SignInFailed)
        return state
    }

    private static StateOf(session: DesktopSession | undefined): AccountState
    {
        if (session === undefined) return { ...AccountService.SignedOutState }
        return { SignedIn: true, Email: session.Email, TenantName: session.TenantName }
    }

    private static ValidChoice(choice: unknown): choice is TargetChoice
    {
        if (typeof choice !== 'object' || choice === null) return false
        const { Environment, GraphName } = choice as Record<string, unknown>
        return typeof Environment === 'string' && Environment !== '' && (GraphName === undefined || typeof GraphName === 'string')
    }

    private static CopyChoice(choice: TargetChoice): TargetChoice
    {
        return choice.GraphName === undefined ? { Environment: choice.Environment } : { Environment: choice.Environment, GraphName: choice.GraphName }
    }
}
