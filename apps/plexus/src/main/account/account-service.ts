import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import {
    AccountError, AccountErrorKind, ConsoleAddress, PlatformAccess, PlatformAddress, TargetIdentity, TargetKind, TargetSource, TenantPlaneAddress, UrlBase,
    type AccountState, type AccountTargets, type DiscoveredTenant, type TargetChoice,
} from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { CompletedSignIn, DesktopApiClient, DesktopRealmSignIn, DiscoveredConsole, ServedTenant } from './desktop-api-client.js'
import type { DesktopSession, DesktopSessionStore, PlatformSession, RealmGrant, SessionAddress, StoredAccount } from './desktop-session-store.js'
import type { IRedirectReceiver } from './loopback-redirect-receiver.js'
import { RealmAuthorization, RealmGrantRefused, RealmIdToken, RealmTokenClient, type RealmIdentity } from './realm-sign-in.js'

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

// Where a console sign-in goes: the address, its tenant and, for an in-hive tenant that also has
// platform environments, the tenant plane to offer the platform sign-in at. SignIn, when the console
// names its realm's desktop sign-in, sends the attempt to the realm (TenantName then from the console).
type ConsoleTarget = { ConsoleUrl: string; TenantId: string; PlatformSignInUrl?: string; SignIn?: DesktopRealmSignIn; TenantName?: string }

// A part that can be ended: its address and token, and the realm grant when it has one.
type EndablePart = SessionAddress & { Realm?: RealmGrant }

// What a console commit replaced: the console part, and a platform part it did not keep.
type Replaced = { Console?: DesktopSession; Platform?: PlatformSession }

// The Plexus account, main-process side. Sign-in: discover the email's tenant on the platform, begin
// a sign-in at the tenant's console with a loopback redirect and a binding challenge, open the system
// browser, wait for the code on the loopback, complete with the binding verifier, store the desktop
// session encrypted. The token stays here: State() reports only email + tenant name (and whether
// the platform step is offered or done), and every change is raised on Changed for the IPC layer to
// push.
//
// An in-hive tenant whose platform also holds environments of it gets a second session, the platform
// part, signed in at the platform's tenant plane on request (SignInAtPlatform). The two parts live
// and die apart: a SignedOut answer (targets here, relay connects via HandleSignedOut) clears only
// the part holding that token, and only while it is still the stored one, so a late 401 for a part
// already replaced or signed out writes nothing. A platform part outlives a console 401 (dormant) and
// is reattached by a console sign-in for the same tenant and email. A platform part past its expiry
// is treated as absent; Targets and SessionFor drop it (ending it at the platform) and announce the
// offer again on Changed, as does any other write.
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
    private static readonly DropPlatformFailedLog = '[account] could not drop the signed-out platform session:'
    private static readonly DropExpiredFailedLog = '[account] could not drop the expired platform session:'
    // A realm access token is renewed when it has less than this left (or half its lifetime, when
    // that is shorter, so a short-lived token is not renewed on every use).
    private static readonly RefreshMarginMs = 60_000
    private static readonly HalfLifetime = 2
    private static readonly SaveRenewedFailedLog = '[account] could not store the renewed realm grant:'

    public readonly Changed = new Signal<AccountState>()
    // Consoles: tenant id -> the discovered console to sign in at; TenantPlaneUrl: the platform's
    // tenant plane from the same answer (main-process only).
    private discovered: { PlatformUrl: string; Email: string; TenantPlaneUrl?: string; Consoles: ReadonlyMap<string, DiscoveredConsole> } | undefined
    private attempt: SignInAttempt | undefined
    // RememberChoice read-modify-writes run one at a time, so concurrent calls neither share a temp
    // file nor lose each other's update.
    private choiceWrites: Promise<void> = Promise.resolve()
    // Every read-compare-write of the stored session (a sign-in storing its session, a 401 clearing
    // the one it was for, a sign-out clearing) runs one at a time, so a stale 401 can never load the
    // old session, then clear the one a concurrent sign-in has just saved.
    private sessionWrites: Promise<void> = Promise.resolve()
    // The renewal in flight: callers arriving meanwhile share it, so a realm that cannot be reached
    // costs one time-out, not one per queued caller (and a sign-out queued behind them waits once).
    private renewal: Promise<StoredAccount> | undefined

    public constructor(
        private readonly store: DesktopSessionStore,
        private readonly choicesDir: string,
        private readonly client: DesktopApiClient,
        private readonly receivers: () => IRedirectReceiver,
        private readonly openExternal: (url: string) => Promise<void>,
        private readonly now: () => number = Date.now,
        private readonly realm: RealmTokenClient = new RealmTokenClient(globalThis.fetch, now),
    )
    {
    }

    public async State(): Promise<AccountState>
    {
        return this.StateOf(await this.store.Load())
    }

    // Main-process only (the relay connector): where a target of `source` is reached and the token that proves it. The
    // platform part answers only beside a console part, and only while it is live.
    public async SessionFor(source: TargetSource): Promise<SessionAddress | undefined>
    {
        const account = source === TargetSource.Console ? await this.FreshAccount() : await this.store.Load()
        if (source === TargetSource.Platform) await this.DropExpiredPlatform(account)
        const part = source === TargetSource.Platform ? this.PlatformBeside(account) : account.Console
        return part === undefined ? undefined : { ConsoleUrl: part.ConsoleUrl, Token: part.Token }
    }

    public async Discover(platformUrl: string, email: string): Promise<DiscoveredTenant[]>
    {
        const platform = AccountService.Platform(platformUrl)
        const address = email.trim()
        const found = await this.client.Discover(platform, address)
        // No tenant plane is normal (a platform serving in-hive consoles only); a given one must be usable.
        if (found.TenantPlaneUrl !== undefined && !TenantPlaneAddress.IsUsable(found.TenantPlaneUrl)) throw new AccountError(AccountErrorKind.Unavailable)
        this.discovered = { PlatformUrl: platform, Email: address, TenantPlaneUrl: found.TenantPlaneUrl, Consoles: new Map(found.Tenants.map(t => [t.Id, t])) }
        // Exactly the renderer's shape: a console address never crosses IPC.
        return found.Tenants.map(t => ({ Id: t.Id, DisplayName: t.DisplayName }))
    }

    public SignIn(platformUrl: string, email: string, tenantId: string): Promise<AccountState>
    {
        const address = email.trim()
        return this.RunConsoleAttempt(async () =>
        {
            const { Console: found, TenantPlaneUrl } = await this.ConsoleFor(AccountService.Platform(platformUrl), address, tenantId)
            const target: ConsoleTarget = { ConsoleUrl: AccountService.SignInAddress(found), TenantId: tenantId }
            // An in-hive console that names its realm's sign-in sends the attempt to the realm (no
            // platform step there: platform environments belong to the transitional path).
            const served = found.FromTenantPlane ? undefined : await this.Lookup(target.ConsoleUrl)
            if (served?.SignIn !== undefined)
            {
                if (served.TenantId !== tenantId) throw new AccountError(AccountErrorKind.SignInFailed)
                return { ...target, SignIn: served.SignIn, TenantName: served.TenantName }
            }
            // The platform step is offered only when the tenant signs in somewhere other than the
            // tenant plane (signed in there, it already sees the platform's environments), and only
            // when the platform has a tenant plane to offer it at.
            if (found.PlatformEnvironments && !found.FromTenantPlane && TenantPlaneUrl !== undefined) target.PlatformSignInUrl = UrlBase.Of(TenantPlaneUrl)
            return target
        }, address)
    }

    // Signs in at a console address the user typed: it names its own tenant, so no email is sent to
    // it. Nothing says whether the platform holds environments of it, so no platform step is offered.
    public SignInAtConsole(consoleUrl: string, email: string): Promise<AccountState>
    {
        if (ConsoleAddress.Validate(consoleUrl) !== undefined) return Promise.reject(new AccountError(AccountErrorKind.ConsoleAddressInvalid))
        const normalised = ConsoleAddress.Normalise(consoleUrl)
        return this.RunConsoleAttempt(async () =>
        {
            const served = await this.client.Console(normalised)
            return { ConsoleUrl: normalised, TenantId: served.TenantId, SignIn: served.SignIn, TenantName: served.TenantName }
        }, email.trim())
    }

    // The platform step: the same browser sign-in, at the tenant plane the console part was offered,
    // for the console part's tenant. Signed out: SignedOut; nothing offered: Unavailable.
    public SignInAtPlatform(): Promise<AccountState>
    {
        return this.RunAttempt(async attempt =>
        {
            const owner = (await this.store.Load()).Console
            if (owner === undefined) throw new AccountError(AccountErrorKind.SignedOut)
            const address = owner.PlatformSignInUrl
            if (address === undefined) throw new AccountError(AccountErrorKind.Unavailable)
            attempt.Check()
            const done = await this.Authorize(attempt, address, owner.TenantId)
            const session: PlatformSession = { ConsoleUrl: address, Token: done.Token, ExpiresAt: done.ExpiresAt, TenantId: done.TenantId, Email: done.Email ?? owner.Email }
            // A session for another tenant is of no use beside this console part: end it at once.
            if (done.TenantId !== owner.TenantId)
            {
                await this.EndQuietly(session)
                throw new AccountError(AccountErrorKind.SignInFailed)
            }
            return this.CommitPlatform(session, owner.Token)
        })
    }

    public async CancelSignIn(): Promise<void>
    {
        this.attempt?.Cancel()
    }

    // Clears locally, then ends both parts that were stored (a dormant platform part too) each at its
    // own address when that can be reached. Reading and clearing are one serialised step, so a part
    // committed meanwhile is either read here and ended, or committed after the clear (and refused).
    public async SignOut(): Promise<AccountState>
    {
        const { Console: own, Platform: platform } = await this.Serialised(async () =>
        {
            const stored = await this.store.Load()
            await this.Forget()
            return stored
        })
        await Promise.all([own, platform].map(part => part === undefined ? undefined : this.EndQuietly(part)))
        return { ...AccountService.SignedOutState }
    }

    // A console said the session holding `token` is over (expired, revoked, signed out elsewhere).
    // Only the part holding it is dropped, and only while it is still the stored one: a 401 that
    // arrives after a sign-out or a new sign-in belongs to an old session, and writes and emits
    // nothing. A console 401 leaves the platform part dormant; a platform 401 leaves the console part.
    public async HandleSignedOut(token: string): Promise<void>
    {
        const dropped = await this.Serialised(async (): Promise<RealmGrant | undefined> =>
        {
            const current = await this.store.Load()
            let next: StoredAccount
            let grant: RealmGrant | undefined
            if (current.Console !== undefined && current.Console.Token === token)
            {
                next = { Platform: this.Live(current.Platform) }
                grant = current.Console.Realm
            }
            else if (current.Platform !== undefined && current.Platform.Token === token)
            {
                next = { Console: current.Console }
            }
            else
            {
                return undefined
            }
            await this.store.Save(next)
            // A dormant platform part dropped while signed out changes nothing the user sees.
            const state = this.StateOf(next)
            if (!AccountService.SameState(state, this.StateOf(current))) this.Changed.emit(state)
            return grant
        })
        // The console refused the realm access token: the grant behind it is ended too, outside the
        // serialised writes so a slow realm holds up no other session change.
        if (dropped !== undefined) await this.RevokeQuietly(dropped)
    }

    // The console's targets, and beside them the platform's when a live platform part exists. A
    // console failure fails the call; a platform failure only leaves the platform set out (a platform
    // 401 also drops the platform part).
    public async Targets(): Promise<AccountTargets>
    {
        const account = await this.FreshAccount()
        if (account.Console === undefined) throw new AccountError(AccountErrorKind.SignedOut)
        await this.DropExpiredPlatform(account)
        const platform = this.PlatformBeside(account)
        const [own, beside] = await Promise.all([
            this.ConsoleTargets(account.Console),
            platform === undefined ? Promise.resolve(undefined) : this.PlatformTargets(platform),
        ])
        if (beside === undefined) return own
        return { Contribute: [...own.Contribute, ...beside.Contribute], Publish: [...own.Publish, ...beside.Publish] }
    }

    public async LastChoice(kind: TargetKind): Promise<TargetChoice | undefined>
    {
        const session = (await this.store.Load()).Console
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
        const session = (await this.store.Load()).Console
        if (session === undefined) throw new AccountError(AccountErrorKind.SignedOut)
        const choices = await this.ReadChoices()
        choices[session.TenantId] = { ...choices[session.TenantId], [kind]: AccountService.CopyChoice(choice) }
        await fs.mkdir(this.choicesDir, { recursive: true })
        const target = join(this.choicesDir, AccountService.ChoicesFile)
        const temp = `${target}${AccountService.TempSuffix}`
        await fs.writeFile(temp, JSON.stringify(choices, null, AccountService.JsonIndent))
        await fs.rename(temp, target)
    }

    // The attempt is created first so a cancel during any step (discovery, console lookup, the
    // browser wait, Complete) is honoured; a failure after a cancel reports Cancelled.
    private async RunAttempt(run: (attempt: SignInAttempt) => Promise<AccountState>): Promise<AccountState>
    {
        // Without secure storage the session could never be kept: say so before the browser opens.
        if (!this.store.CanStore()) throw new AccountError(AccountErrorKind.SecureStorageUnavailable)
        this.attempt?.Cancel()
        const attempt = new SignInAttempt(this.receivers())
        this.attempt = attempt
        try
        {
            return await run(attempt)
        }
        catch (e)
        {
            attempt.Check()
            throw e
        }
        finally
        {
            if (this.attempt === attempt) this.attempt = undefined
            await attempt.Receiver.Close()
        }
    }

    // A console sign-in: `resolve` names the console and tenant to sign in at.
    private RunConsoleAttempt(resolve: () => Promise<ConsoleTarget>, email: string): Promise<AccountState>
    {
        return this.RunAttempt(async attempt =>
        {
            const target = await resolve()
            attempt.Check()
            if (target.SignIn !== undefined) return this.CommitConsole(await this.AuthorizeAtRealm(attempt, target, target.SignIn, email))
            const done = await this.Authorize(attempt, target.ConsoleUrl, target.TenantId)
            const session: DesktopSession = {
                ConsoleUrl: target.ConsoleUrl, Token: done.Token, Email: done.Email ?? email, TenantId: done.TenantId, TenantName: done.TenantName, ExpiresAt: done.ExpiresAt,
            }
            if (target.PlatformSignInUrl !== undefined) session.PlatformSignInUrl = target.PlatformSignInUrl
            return this.CommitConsole(session)
        })
    }

    // The browser sign-in at `address` (already the validated, final address) for `tenantId`: Begin
    // with a binding challenge, open the browser, wait for the code, Complete with the verifier. The
    // email is never sent: the caller fills it in when Complete names none.
    private async Authorize(attempt: SignInAttempt, address: string, tenantId: string): Promise<CompletedSignIn>
    {
        const verifier = randomBytes(AccountService.VerifierBytes).toString(AccountService.Base64Url)
        const challenge = createHash(AccountService.Sha256).update(verifier).digest(AccountService.Base64Url)
        const { RedirectUri } = await attempt.Receiver.Start()
        attempt.Check()
        const authorizeUrl = await this.client.Begin(address, tenantId, RedirectUri, challenge)
        attempt.Check()
        const state = AccountService.StateIn(authorizeUrl)
        const code = attempt.Receiver.WaitForCode(state)
        const [, received] = await Promise.all([this.openExternal(authorizeUrl), code])
        attempt.Check()
        const done = await this.client.Complete(address, state, received, verifier)
        // Cancelled while Complete was in flight: the console already issued a session; end it
        // rather than leave a live token nobody holds. Past this point the sign-in is committed.
        if (attempt.Cancelled)
        {
            await this.EndQuietly({ ConsoleUrl: address, Token: done.Token })
            attempt.Check()
        }
        return done
    }

    // The realm sign-in (spec 2026-11-20-e section 6): the realm's endpoints from its discovery
    // document, the authorization code request with PKCE, state and nonce in the system browser, the
    // code from the loopback, the exchange as the public client, the ID token's claims. A grant issued
    // but not kept (cancelled meanwhile, an ID token that fails its checks) is revoked at once.
    private async AuthorizeAtRealm(attempt: SignInAttempt, target: ConsoleTarget, signIn: DesktopRealmSignIn, email: string): Promise<DesktopSession>
    {
        const provider = await this.realm.Discover(signIn.Issuer)
        attempt.Check()
        const { RedirectUri } = await attempt.Receiver.Start()
        attempt.Check()
        const request = RealmAuthorization.Create(provider, signIn.ClientId, RedirectUri)
        const code = attempt.Receiver.WaitForCode(request.State)
        const [, received] = await Promise.all([this.openExternal(request.Url()), code])
        attempt.Check()
        const tokens = await this.realm.ExchangeCode(request, received)
        const grant: RealmGrant = {
            Issuer: provider.Issuer, ClientId: signIn.ClientId, RefreshToken: tokens.RefreshToken, TokenEndpoint: provider.TokenEndpoint, RenewAt: this.RenewAt(tokens.LifetimeMs),
        }
        if (provider.RevocationEndpoint !== undefined) grant.RevocationEndpoint = provider.RevocationEndpoint
        let identity: RealmIdentity
        try
        {
            attempt.Check()
            identity = RealmIdToken.Check(tokens.IdToken, provider.Issuer, signIn.ClientId, request.Nonce, this.now())
        }
        catch (e)
        {
            await this.RevokeQuietly(grant)
            throw e
        }
        return {
            ConsoleUrl: target.ConsoleUrl, Token: tokens.AccessToken, Email: identity.Email ?? email, TenantId: target.TenantId,
            TenantName: target.TenantName ?? target.TenantId, ExpiresAt: tokens.ExpiresAt, Realm: grant,
        }
    }

    // The console's own answer to "which tenant are you", or undefined when it gives none: the
    // transitional path then runs and reports its own failure (ruling E4).
    private async Lookup(consoleUrl: string): Promise<ServedTenant | undefined>
    {
        try
        {
            return await this.client.Console(consoleUrl)
        }
        catch
        {
            return undefined
        }
    }

    // The stored account with a realm access token that is still good for a while: one due for renewal
    // is renewed first, one refresh at a time (ruling E6), re-reading the stored grant so a refresh
    // another caller just made is used, not repeated. A refused refresh ends the session (SignedOut);
    // a realm that cannot be reached fails the call and keeps the session.
    private async FreshAccount(): Promise<StoredAccount>
    {
        // A renewal in flight answers the account it renews, so it is shared before anything is read.
        if (this.renewal !== undefined) return this.renewal
        const account = await this.store.Load()
        if (!this.NeedsRefresh(account.Console)) return account
        if (this.renewal !== undefined) return this.renewal
        const run = this.Serialised(async () =>
        {
            const current = await this.store.Load()
            return this.NeedsRefresh(current.Console) ? this.RenewStored(current) : current
        })
        this.renewal = run
        const clear = (): void =>
        {
            if (this.renewal === run) this.renewal = undefined
        }
        run.then(clear, clear)
        return run
    }

    // Main-process only (the relay connector, the targets call): the console refused `token`. A realm
    // part still holding it is renewed once (the desktop clock may run behind the realm's) and its
    // fresh address answered; a realm part already holding a newer token (renewed meanwhile) answers
    // that one without renewing. Undefined when no realm part is stored, or the realm refused the
    // renewal (then signed out). The caller retries once with the answer, and a second refusal signs
    // out through HandleSignedOut.
    public Renew(token: string): Promise<SessionAddress | undefined>
    {
        return this.Serialised(async () =>
        {
            const current = await this.store.Load()
            if (current.Console?.Realm === undefined) return undefined
            if (current.Console.Token !== token) return { ConsoleUrl: current.Console.ConsoleUrl, Token: current.Console.Token }
            let renewed: StoredAccount
            try
            {
                renewed = await this.RenewStored(current)
            }
            catch (e)
            {
                if (AccountService.IsSignedOut(e)) return undefined
                throw e
            }
            const part = renewed.Console!
            return { ConsoleUrl: part.ConsoleUrl, Token: part.Token }
        })
    }

    // Renews the stored realm part (called inside the serialised writes) and stores the result.
    private async RenewStored(current: StoredAccount): Promise<StoredAccount>
    {
        const part = current.Console!
        const grant = part.Realm!
        let renewed: DesktopSession
        try
        {
            const tokens = await this.realm.Refresh(grant)
            renewed = {
                ...part, Token: tokens.AccessToken, ExpiresAt: tokens.ExpiresAt,
                Realm: { ...grant, RefreshToken: tokens.RefreshToken ?? grant.RefreshToken, RenewAt: this.RenewAt(tokens.LifetimeMs) },
            }
        }
        catch (e)
        {
            if (!(e instanceof RealmGrantRefused)) throw e
            const left: StoredAccount = { Platform: this.Live(current.Platform) }
            await this.store.Save(left)
            this.Changed.emit(this.StateOf(left))
            throw new AccountError(AccountErrorKind.SignedOut)
        }
        const next: StoredAccount = { Console: renewed, Platform: current.Platform }
        try
        {
            await this.store.Save(next)
        }
        catch (e)
        {
            // The realm already rotated the refresh token: the stored one is spent, so the next renewal
            // is refused (and the realm ends the family) and the person signs in again. Logged by name.
            console.warn(AccountService.SaveRenewedFailedLog, { name: e instanceof Error ? e.name : typeof e })
            throw e
        }
        return next
    }

    private NeedsRefresh(part: DesktopSession | undefined): boolean
    {
        return part?.Realm !== undefined && !(Date.parse(part.Realm.RenewAt) > this.now())
    }

    // When a token living `lifetimeMs` from now is due for renewal.
    private RenewAt(lifetimeMs: number): string
    {
        const margin = Math.min(AccountService.RefreshMarginMs, lifetimeMs / AccountService.HalfLifetime)
        return new Date(this.now() + lifetimeMs - margin).toISOString()
    }

    // Stores a fresh console part. The stored platform part stays when it is live and of the same
    // tenant and email; otherwise it is ended and dropped. A replaced console part is ended too.
    private async CommitConsole(session: DesktopSession): Promise<AccountState>
    {
        const { Account, Replaced } = await this.Commit(session, async () =>
        {
            const previous = await this.store.Load()
            const platform = this.Live(previous.Platform)
            // A realm session keeps no platform part (that belongs to the transitional path).
            const keep = session.Realm === undefined && platform !== undefined && platform.TenantId === session.TenantId && platform.Email === session.Email
            const account: StoredAccount = { Console: session, Platform: keep ? platform : undefined }
            await this.store.Save(account)
            const gone: Replaced = { Console: previous.Console }
            if (!keep && previous.Platform !== undefined) gone.Platform = previous.Platform
            return { Account: account, Replaced: gone }
        })
        const ended: Promise<void>[] = []
        if (Replaced.Console !== undefined && Replaced.Console.Token !== session.Token) ended.push(this.EndQuietly(Replaced.Console))
        if (Replaced.Platform !== undefined) ended.push(this.EndQuietly(Replaced.Platform))
        await Promise.all(ended)
        return this.Announce(Account)
    }

    // Stores a fresh platform part beside the console part it was signed in for (the one holding
    // `ownerToken` when the attempt started), and ends the one it replaces. That console part gone or
    // replaced meanwhile, even by a session of the same tenant and email: the fresh part has nothing
    // to sit beside, so it is ended and the call fails SignedOut.
    private async CommitPlatform(session: PlatformSession, ownerToken: string): Promise<AccountState>
    {
        const kept = await this.Commit(session, async () =>
        {
            const current = await this.store.Load()
            if (current.Console === undefined || current.Console.Token !== ownerToken || current.Console.TenantId !== session.TenantId) return undefined
            await this.store.Save({ Console: current.Console, Platform: session })
            return { Account: { Console: current.Console, Platform: session }, Previous: current.Platform }
        })
        if (kept === undefined)
        {
            await this.EndQuietly(session)
            throw new AccountError(AccountErrorKind.SignedOut)
        }
        if (kept.Previous !== undefined && kept.Previous.Token !== session.Token) await this.EndQuietly(kept.Previous)
        return this.Announce(kept.Account)
    }

    // Runs a store write for a freshly issued session. When it cannot be stored the console has
    // already issued it, so it is ended there before the failure is reported.
    private async Commit<T>(session: EndablePart, write: () => Promise<T>): Promise<T>
    {
        try
        {
            return await this.Serialised(write)
        }
        catch (e)
        {
            await this.EndQuietly(session)
            throw e
        }
    }

    private Announce(account: StoredAccount): AccountState
    {
        const state = this.StateOf(account)
        this.Changed.emit(state)
        return state
    }

    // From the cached discovery; discovered again when the platform or email differ or the tenant is
    // not in the cached answer (it may be stale). Still absent afterwards: no such account.
    private async ConsoleFor(platform: string, email: string, tenantId: string): Promise<{ Console: DiscoveredConsole; TenantPlaneUrl: string | undefined }>
    {
        const cached = this.discovered
        const fresh = cached !== undefined && cached.PlatformUrl === platform && cached.Email === email && cached.Consoles.has(tenantId)
        if (!fresh) await this.Discover(platform, email)
        const discovered = this.discovered!
        const found = discovered.Consoles.get(tenantId)
        if (found === undefined) throw new AccountError(AccountErrorKind.NoAccount)
        return { Console: found, TenantPlaneUrl: discovered.TenantPlaneUrl }
    }

    // A 401 for a realm part renews it once and retries; a second 401 (or any 401 of a console
    // session) signs the part out.
    private async ConsoleTargets(session: DesktopSession): Promise<AccountTargets>
    {
        try
        {
            return await this.client.Targets(session, TargetSource.Console)
        }
        catch (e)
        {
            if (!AccountService.IsSignedOut(e)) throw e
            const renewed = session.Realm === undefined ? undefined : await this.Renew(session.Token)
            if (renewed === undefined)
            {
                await this.HandleSignedOut(session.Token)
                throw e
            }
            return this.RetriedTargets(renewed)
        }
    }

    private async RetriedTargets(session: SessionAddress): Promise<AccountTargets>
    {
        try
        {
            return await this.client.Targets(session, TargetSource.Console)
        }
        catch (e)
        {
            if (AccountService.IsSignedOut(e)) await this.HandleSignedOut(session.Token)
            throw e
        }
    }

    // Never fails: a platform 401 drops the platform part; any failure answers no platform set. A
    // store failure while dropping it is logged by name only (never a message, which may carry a path).
    private async PlatformTargets(session: PlatformSession): Promise<AccountTargets | undefined>
    {
        try
        {
            return await this.client.Targets(session, TargetSource.Platform)
        }
        catch (e)
        {
            if (AccountService.IsSignedOut(e)) await this.DropPlatform(session.Token)
            return undefined
        }
    }

    private async DropPlatform(token: string): Promise<void>
    {
        try
        {
            await this.HandleSignedOut(token)
        }
        catch (e)
        {
            console.warn(AccountService.DropPlatformFailedLog, { name: e instanceof Error ? e.name : typeof e })
        }
    }

    // A stored platform part past its expiry (as read in `account`): dropped while it is still the
    // stored one, and ended at its own address in the background, since no one holds it any more. The renderer last saw
    // it signed in when it sat beside the console part of its tenant, so only then is the new state
    // (the offer again) announced; a dormant part changes nothing the user sees. Never fails: a store
    // failure is logged by name only and leaves the part to the next look.
    private async DropExpiredPlatform(account: StoredAccount): Promise<void>
    {
        const expired = account.Platform
        if (expired === undefined || this.Live(expired) !== undefined) return
        try
        {
            const next = await this.Serialised(async () =>
            {
                const current = await this.store.Load()
                if (current.Platform === undefined || current.Platform.Token !== expired.Token) return undefined
                const kept: StoredAccount = { Console: current.Console }
                await this.store.Save(kept)
                return { Account: kept, Shown: current.Console !== undefined && current.Console.TenantId === current.Platform.TenantId }
            })
            if (next === undefined) return
            if (next.Shown) this.Changed.emit(this.StateOf(next.Account))
            // Not awaited: a hanging platform address must not delay the offer or the caller's targets.
            void this.EndQuietly(expired)
        }
        catch (e)
        {
            console.warn(AccountService.DropExpiredFailedLog, { name: e instanceof Error ? e.name : typeof e })
        }
    }

    // The platform part when it is live and sits beside a console part of its tenant.
    private PlatformBeside(account: StoredAccount): PlatformSession | undefined
    {
        const platform = this.Live(account.Platform)
        if (account.Console === undefined || platform === undefined || platform.TenantId !== account.Console.TenantId) return undefined
        return platform
    }

    // Live: present (the store keeps only complete parts) and not yet expired.
    private Live(platform: PlatformSession | undefined): PlatformSession | undefined
    {
        return platform !== undefined && Date.parse(platform.ExpiresAt) > this.now() ? platform : undefined
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
        this.Changed.emit({ ...AccountService.SignedOutState })
    }

    // Ends a part at its console and, for a realm part, its grant at the realm; both quietly.
    private async EndQuietly(at: EndablePart): Promise<void>
    {
        await Promise.all([
            this.SignOutQuietly({ ConsoleUrl: at.ConsoleUrl, Token: at.Token }),
            at.Realm === undefined ? undefined : this.RevokeQuietly(at.Realm),
        ])
    }

    private async SignOutQuietly(at: SessionAddress): Promise<void>
    {
        try
        {
            await this.client.SignOut(at)
        }
        catch
        {
            // unreachable or refused: the local copy is dropped regardless
        }
    }

    private async RevokeQuietly(grant: RealmGrant): Promise<void>
    {
        try
        {
            await this.realm.Revoke(grant)
        }
        catch
        {
            // unreachable: the refresh token lives until the realm expires it; nothing here holds it
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

    // The address a discovered tenant signs in at, or Unavailable before anything is dialled. A
    // tenant's own console must be a bare origin and is normalised to it; the platform's tenant plane
    // only follows the transport rule and keeps its base path (trailing slashes dropped).
    private static SignInAddress(found: DiscoveredConsole): string
    {
        if (found.FromTenantPlane)
        {
            if (!TenantPlaneAddress.IsUsable(found.ConsoleUrl)) throw new AccountError(AccountErrorKind.Unavailable)
            return UrlBase.Of(found.ConsoleUrl)
        }
        if (ConsoleAddress.Validate(found.ConsoleUrl) !== undefined) throw new AccountError(AccountErrorKind.Unavailable)
        return ConsoleAddress.Normalise(found.ConsoleUrl)
    }

    private static Platform(platformUrl: string): string
    {
        if (PlatformAddress.Validate(platformUrl) !== undefined) throw new AccountError(AccountErrorKind.Unreachable)
        return platformUrl.trim()
    }

    // The state the browser will hand back is the one the console put in the authorize URL. Only
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

    // Signed out without a console part. Beside one, Platform is SignedIn for a live platform part,
    // Offered when the console part names a platform sign-in address, absent otherwise.
    private StateOf(account: StoredAccount): AccountState
    {
        const session = account.Console
        if (session === undefined) return { ...AccountService.SignedOutState }
        const state: AccountState = { SignedIn: true, Email: session.Email, TenantName: session.TenantName }
        if (this.PlatformBeside(account) !== undefined) state.Platform = PlatformAccess.SignedIn
        else if (session.PlatformSignInUrl !== undefined) state.Platform = PlatformAccess.Offered
        return state
    }

    private static SameState(a: AccountState, b: AccountState): boolean
    {
        return a.SignedIn === b.SignedIn && a.Email === b.Email && a.TenantName === b.TenantName && a.Platform === b.Platform
    }

    private static IsSignedOut(e: unknown): boolean
    {
        return e instanceof AccountError && e.Kind === AccountErrorKind.SignedOut
    }

    private static ValidChoice(choice: unknown): choice is TargetChoice
    {
        if (typeof choice !== 'object' || choice === null) return false
        const { Environment, Source, GraphName, SolutionName } = choice as Record<string, unknown>
        return typeof Environment === 'string' && Environment !== ''
            && (Source === undefined || TargetIdentity.IsSource(Source))
            && (GraphName === undefined || typeof GraphName === 'string')
            && (SolutionName === undefined || typeof SolutionName === 'string')
    }

    private static CopyChoice(choice: TargetChoice): TargetChoice
    {
        const copy: TargetChoice = { Environment: choice.Environment }
        if (choice.Source !== undefined) copy.Source = choice.Source
        if (choice.GraphName !== undefined) copy.GraphName = choice.GraphName
        if (choice.SolutionName !== undefined) copy.SolutionName = choice.SolutionName
        return copy
    }
}
