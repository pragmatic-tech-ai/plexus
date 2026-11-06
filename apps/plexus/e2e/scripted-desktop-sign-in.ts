// Scripted desktop sign-in for the live e2e specs: signs the launched Plexus in to its account
// WITHOUT a real browser, through the app's real sign-in path.
//
//   0. The app must run on an isolated E2eProfile (launchPlexus(profile)): the helper checks the
//      launched app's userData IS that temp dir, and refuses a profile that already holds a session.
//      It never touches the developer's own profile and never signs out a session it did not create.
//   1. The main process's browser opener is intercepted: AccountService opens the authorize URL
//      through `shell.openExternal` (src/main/index.ts), so the helper replaces that function in the
//      Electron main process (electronApp.evaluate) with one that records the URL instead of opening
//      a browser. The original is put back afterwards. Of the recorded URLs only an http(s) URL with
//      state and code_challenge is taken as the authorize URL (an external link opened meanwhile is
//      skipped).
//   2. The sign-in starts exactly as a picker's "Sign in" does: IAccountService.RequestSignIn() opens
//      the account dialog (AccountDialogHost.CurrentDialog), and the helper drives the dialog view
//      model: Email, then its ContinueCommand (discover -> tenant chooser -> sign in -> waiting on the
//      browser).
//   3. The recorded authorize URL is driven over HTTP by IdpPasswordLogin (the server smoke's
//      RunLogin: GET, keep the cookie, POST the password form, follow the redirect to the loopback
//      callback), so Plexus's own loopback receiver completes the sign-in and stores the session.
//   4. It waits until the account reports signed in and the dialog's request resolved true - or, for
//      a tenant that also has platform environments, until the dialog stops on PlatformOffer. The
//      spec then either signs in at the platform (SignInAtPlatform: the dialog's PlatformSignInCommand,
//      the same opener interception and an IdP login with the platform credentials) or presses Skip
//      (SkipPlatform); both end with the dialog closed and its request resolved true.
// AttemptConsoleSignIn() tries the typed console path straight on the account service and answers
// the AccountError kind it failed with (the retired-console check); it records whether any browser
// URL was opened meanwhile (LastAttemptOpenedBrowser).
// SignOut() ends the session whenever a sign-in was attempted on the session-free profile (call it
// before closing the app, also after a failed SignIn); the profile's Dispose() then deletes what is
// left on disk.
//
// Services are found in the renderer's service-provider cache by their ServiceKey description (a
// stable string, unlike a constructor name under minification) - the same cache walk plexus-app.ts
// uses; ServiceProvider has no public enumeration.
//
// Inputs (environment variables):
//   PLEXUS_E2E_OWNER_EMAIL          account email to sign in with (required)
//   PLEXUS_E2E_OWNER_PASSWORD_FILE  path of a file holding that account's password (required; read,
//                                   never printed)
//   PLEXUS_E2E_PLATFORM_ADDRESS     platform address for this sign-in (optional; written to the
//                                   isolated profile's account.platformAddress setting; default: that
//                                   setting's default, http://localhost:7000)
//   PLEXUS_E2E_TENANT               tenant id or display name to pick when the email belongs to
//                                   several tenants (optional; default: the first one listed; a value
//                                   matching no listed tenant fails the sign-in)
//   PLEXUS_E2E_IDP_CA_FILE          the IdP's dev CA certificate (optional; for an https IdP with a
//                                   private CA, added to Node's default trust)
//   PLEXUS_E2E_IDP_LOGIN            how the IdP login runs: `http` (default; Node http(s) against a
//                                   server-rendered login form, as the control-plane IdP serves) or
//                                   `browser` (a separate headless Chromium that types into a
//                                   JavaScript login page, as the in-hive tenant IdP serves; it trusts
//                                   the OS root store, so PLEXUS_E2E_IDP_CA_FILE is not used)
//   PLEXUS_IHC_PLATFORM_EMAIL       the email for the platform sign-in (optional; default:
//                                   PLEXUS_E2E_OWNER_EMAIL)
//   PLEXUS_IHC_PLATFORM_PASSWORD_FILE  path of a file holding the platform account's password
//                                   (optional; SignInAtPlatform needs it; read, never printed). The
//                                   platform IdP is not the in-hive IdP, so its password differs.
// SignIn takes an optional ConsoleAddress: the dialog then signs in at that in-hive console address
// (the typed path) instead of discovering tenants from the platform address.
import { readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from 'playwright'
import { PlatformAccess } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountDialogStep } from '../src/renderer/src/modules/account/account-dialog-step'
import { IdpBrowserLogin } from './support/idp-browser-login'
import { IdpPasswordLogin } from './support/idp-password-login'
import type { E2eProfile } from './support/e2e-profile'
import { IdpLoginKind, SignInChecks, type TenantRow } from './support/sign-in-checks'

// The dialog's progress as the renderer reports it to the node side.
interface DialogProbe
{
    Open: boolean
    Step?: string
    Message?: string
    Done?: boolean
    SignedIn?: boolean
    Platform?: string
    Tenants?: TenantRow[]
}

// The account state as the renderer's account service reports it (never a token).
export interface ScriptedAccountState
{
    SignedIn: boolean
    Email?: string
    TenantName?: string
    Platform?: string
}

// One environment row of the sign-in targets.
export interface ScriptedTarget
{
    Id: string
    Name: string
    Status: string
    Source: string
}

// The sign-in targets, or the AccountError kind when the call is refused (e.g. signed out).
export interface ScriptedTargets
{
    Targets?: { Contribute: ScriptedTarget[]; Publish: ScriptedTarget[] }
    ErrorKind?: string
}

// What locating the services found: a fault sentence, or whether the profile is signed in.
interface LocateResult
{
    Fault?: string
    SignedIn?: boolean
}

// The IdP login leg: runs the login for one authorize URL.
export interface IIdpLogin
{
    Run(authorizeUrl: string, email: string, password: string): Promise<void>
}

// Options for one SignIn.
export interface ScriptedSignInOptions
{
    // An in-hive console address to type into the dialog (signs in at the console, no discovery).
    ConsoleAddress?: string
}

export class ScriptedDesktopSignIn
{
    public static readonly EmailEnv = 'PLEXUS_E2E_OWNER_EMAIL'
    public static readonly PasswordFileEnv = 'PLEXUS_E2E_OWNER_PASSWORD_FILE'
    public static readonly PlatformAddressEnv = 'PLEXUS_E2E_PLATFORM_ADDRESS'
    public static readonly TenantEnv = 'PLEXUS_E2E_TENANT'
    public static readonly IdpCaFileEnv = 'PLEXUS_E2E_IDP_CA_FILE'
    public static readonly IdpLoginEnv = 'PLEXUS_E2E_IDP_LOGIN'
    public static readonly IdpLoginBrowser = IdpLoginKind.Browser
    public static readonly PlatformEmailEnv = 'PLEXUS_IHC_PLATFORM_EMAIL'
    public static readonly PlatformPasswordFileEnv = 'PLEXUS_IHC_PLATFORM_PASSWORD_FILE'
    public static readonly SkipMessage =
        `needs a scripted desktop sign-in: set ${ScriptedDesktopSignIn.EmailEnv} (account email) and `
        + `${ScriptedDesktopSignIn.PasswordFileEnv} (path of a file holding its password)`

    private static readonly UnknownErrorKind = 'unknown'
    private static readonly TimedOutKind = 'timed-out'
    private static readonly RelayCallTimeoutMs = 60_000
    private static readonly OpenerKey = '__plexusE2eOpener'
    private static readonly StateKey = '__plexusE2eSignIn'
    private static readonly VisualBackref = 'mural:visual-backref'
    // ServiceKey descriptions (AccountDialogHost.Key, AccountServiceKey, ApplicationSettings.Key).
    private static readonly DialogHostKey = 'AccountDialogHost'
    private static readonly AccountKey = 'AccountService'
    private static readonly SettingsKey = 'ApplicationSettings'
    // AccountDialogHost.PlatformAddressSetting.
    private static readonly PlatformAddressSetting = 'account.platformAddress'
    private static readonly Utf8 = 'utf8'
    private static readonly PollMs = 250
    private static readonly OpenTimeoutMs = 60_000
    private static readonly SignedInTimeoutMs = 60_000
    private static readonly NotIsolated =
        'the app is not running on the e2e profile: launch it with launchPlexus(profile) so the developer profile is never touched'
    private static readonly NotIntercepted = 'could not replace shell.openExternal in the Electron main process'
    private static readonly NoServices = 'the account services were not found in the renderer within the timeout'
    private static readonly NoDialog = 'the account dialog did not open (no AccountDialogHost, or a dialog was already open)'
    private static readonly NoAddressSetting = 'the platform address setting could not be set in the e2e profile'
    private static readonly CannotContinue = 'the account dialog cannot continue: Continue is disabled'
    private static readonly NoAuthorizeUrl = 'the app never opened an authorize URL within the timeout'
    private static readonly DialogFailedPrefix = 'the account dialog reported: '
    private static readonly NotSignedIn = 'the account did not report signed in after the loopback callback'
    private static readonly EmptyPassword = 'the password file is empty'
    private static readonly EmptyPlatformPassword = 'the platform password file is empty'
    private static readonly NoPlatformLogin =
        `the platform sign-in needs ${ScriptedDesktopSignIn.PlatformPasswordFileEnv} (path of a file holding the platform account's password)`
    private static readonly NoPlatformOffer = 'the account dialog does not offer the platform sign-in (not on PlatformOffer, or closed)'
    private static readonly NotPlatformSignedIn = 'the account did not report the platform signed in after the loopback callback'
    private static readonly NotSkipped = 'the account dialog did not close after Skip'
    private static readonly AttemptTimeoutMs = 60_000

    // Whether this instance started a sign-in on the session-free profile (so any session at teardown
    // is this run's, and SignOut ends it).
    private signInAttempted = false
    // Whether the last AttemptConsoleSignIn saw the app open any URL in a browser.
    private lastAttemptOpenedBrowser = false

    private constructor(
        private readonly email: string,
        private readonly password: string,
        private readonly platformAddress: string | undefined,
        private readonly tenant: string | undefined,
        private readonly login: IIdpLogin,
        private readonly platformEmail: string,
        private readonly platformPassword: string | undefined,
    )
    {
    }

    // Whether the platform sign-in's credentials were given (SignInAtPlatform needs them).
    public get HasPlatformLogin(): boolean
    {
        return this.platformPassword !== undefined
    }

    // Whether the last AttemptConsoleSignIn saw the app open any URL in a browser.
    public get LastAttemptOpenedBrowser(): boolean
    {
        return this.lastAttemptOpenedBrowser
    }

    // Whether the required inputs are set (the specs skip with SkipMessage otherwise).
    public static IsConfigured(env: NodeJS.ProcessEnv = process.env): boolean
    {
        return ScriptedDesktopSignIn.Value(env, ScriptedDesktopSignIn.EmailEnv) !== undefined
            && ScriptedDesktopSignIn.Value(env, ScriptedDesktopSignIn.PasswordFileEnv) !== undefined
    }

    // Reads the inputs; the password file is read here, into this instance only.
    public static FromEnvironment(env: NodeJS.ProcessEnv = process.env): ScriptedDesktopSignIn
    {
        const S = ScriptedDesktopSignIn
        const email = S.Value(env, S.EmailEnv)
        const passwordFile = S.Value(env, S.PasswordFileEnv)
        if (email === undefined || passwordFile === undefined) throw new Error(S.SkipMessage)
        const password = readFileSync(passwordFile, S.Utf8).trim()
        if (password === '') throw new Error(S.EmptyPassword)
        const caFile = S.Value(env, S.IdpCaFileEnv)
        const login: IIdpLogin = SignInChecks.IdpLoginKindOf(S.Value(env, S.IdpLoginEnv)) === IdpLoginKind.Browser
            ? new IdpBrowserLogin()
            : new IdpPasswordLogin(caFile === undefined ? undefined : readFileSync(caFile))
        const platformPasswordFile = S.Value(env, S.PlatformPasswordFileEnv)
        const platformPassword = platformPasswordFile === undefined ? undefined : readFileSync(platformPasswordFile, S.Utf8).trim()
        if (platformPassword === '') throw new Error(S.EmptyPlatformPassword)
        return new ScriptedDesktopSignIn(email, password, S.Value(env, S.PlatformAddressEnv), S.Value(env, S.TenantEnv), login,
            S.Value(env, S.PlatformEmailEnv) ?? email, platformPassword)
    }

    // Signs the app (launched on `profile`) in; resolves once the account reports signed in.
    public async SignIn(app: ElectronApplication, win: Page, profile: E2eProfile, options: ScriptedSignInOptions = {}): Promise<void>
    {
        const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
        if (!profile.Owns(userData)) throw new Error(ScriptedDesktopSignIn.NotIsolated)
        await this.InterceptOpener(app)
        try
        {
            const located = await this.LocateServices(win)
            if (located.Fault !== undefined) throw new Error(located.Fault)
            const existing = SignInChecks.ExistingSessionFault(located.SignedIn === true)
            if (existing !== undefined) throw new Error(existing)
            this.signInAttempted = true
            await this.OpenDialogAndContinue(win, options.ConsoleAddress)
            const authorizeUrl = await this.AwaitAuthorizeUrl(app, win)
            await this.login.Run(authorizeUrl, this.email, this.password)
            await this.AwaitSignedIn(win)
        }
        finally
        {
            await this.RestoreOpener(app)
        }
    }

    // The dialog stopped on PlatformOffer (after SignIn): presses its platform sign-in, runs the
    // platform IdP login with the platform credentials on the authorize URL the app opened, and
    // resolves once the dialog closed signed in and the account reports the platform signed in.
    public async SignInAtPlatform(app: ElectronApplication, win: Page): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        if (this.platformPassword === undefined) throw new Error(S.NoPlatformLogin)
        await this.InterceptOpener(app)
        try
        {
            const fault = await win.evaluate((p) =>
            {
                const state: any = (window as any)[p.stateKey]
                const dialog = state?.dialog
                if (dialog === undefined || state.host.CurrentDialog !== dialog) return p.noOffer
                if (!dialog.PlatformSignInCommand.CanExecute(undefined)) return p.noOffer
                dialog.PlatformSignInCommand.Execute(undefined)
                return undefined
            }, { stateKey: S.StateKey, noOffer: S.NoPlatformOffer })
            if (fault !== undefined) throw new Error(fault)
            const authorizeUrl = await this.AwaitAuthorizeUrl(app, win)
            await this.login.Run(authorizeUrl, this.platformEmail, this.platformPassword)
            await this.AwaitDone(win, S.NotPlatformSignedIn, (probe) => probe.Platform === PlatformAccess.SignedIn)
        }
        finally
        {
            await this.RestoreOpener(app)
        }
    }

    // The dialog stopped on PlatformOffer (after SignIn): presses Skip and resolves once the dialog
    // closed signed in. A dialog that never offered the platform has closed already.
    public async SkipPlatform(win: Page): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        await win.evaluate((p) =>
        {
            const dialog = (window as any)[p.stateKey]?.dialog
            if (dialog?.Step === p.offerStep) dialog.SkipPlatformCommand.Execute(undefined)
        }, { stateKey: S.StateKey, offerStep: AccountDialogStep.PlatformOffer })
        await this.AwaitDone(win, S.NotSkipped, () => true)
    }

    // Tries the typed console sign-in straight on the account service, with the opener intercepted,
    // and answers the AccountError kind it failed with (undefined when it succeeded). Whether any URL
    // was opened meanwhile is kept in LastAttemptOpenedBrowser. A sign-in that neither fails nor
    // finishes within the timeout is cancelled and answers the timed-out kind.
    public async AttemptConsoleSignIn(app: ElectronApplication, win: Page, profile: E2eProfile, consoleUrl: string): Promise<string | undefined>
    {
        const S = ScriptedDesktopSignIn
        const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
        if (!profile.Owns(userData)) throw new Error(S.NotIsolated)
        await this.InterceptOpener(app)
        try
        {
            const located = await this.LocateServices(win)
            if (located.Fault !== undefined) throw new Error(located.Fault)
            const existing = SignInChecks.ExistingSessionFault(located.SignedIn === true)
            if (existing !== undefined) throw new Error(existing)
            this.signInAttempted = true
            this.lastAttemptOpenedBrowser = false
            const kind = await win.evaluate(async (p) =>
            {
                const account = (window as any)[p.stateKey].account
                let timer: ReturnType<typeof setTimeout> | undefined
                const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject({ Kind: p.timedOutKind }), p.timeoutMs) })
                try
                {
                    await Promise.race([account.SignInAtConsole(p.consoleUrl, p.email), timeout])
                    return undefined
                }
                catch (e)
                {
                    const kind = String((e as any)?.Kind ?? p.unknownKind)
                    if (kind === p.timedOutKind) await account.CancelSignIn().catch(() => undefined)
                    return kind
                }
                finally
                {
                    clearTimeout(timer)
                }
            }, {
                stateKey: S.StateKey, consoleUrl, email: this.email, unknownKind: S.UnknownErrorKind,
                timedOutKind: S.TimedOutKind, timeoutMs: S.AttemptTimeoutMs,
            })
            this.lastAttemptOpenedBrowser = (await this.OpenedUrls(app)).length > 0
            return kind
        }
        finally
        {
            await this.RestoreOpener(app)
        }
    }

    // Ends the session this run created whenever a sign-in was attempted (no-op otherwise), so the
    // owner token does not stay live on the tenant plane after the run - also when SignIn failed
    // after the IdP had already completed the login.
    public async SignOut(win: Page): Promise<void>
    {
        if (!this.signInAttempted) return
        const S = ScriptedDesktopSignIn
        const signedIn = await win.evaluate(async (stateKey) =>
        {
            const account = (window as any)[stateKey]?.account
            if (account === undefined) return false
            await account.Refresh()
            return account.State?.SignedIn === true
        }, S.StateKey)
        if (!SignInChecks.ShouldSignOut(this.signInAttempted, signedIn)) return
        this.signInAttempted = false
        await this.SignOutAccount(win)
    }

    private SignOutAccount(win: Page): Promise<void>
    {
        return win.evaluate(async (stateKey) =>
        {
            await (window as any)[stateKey].account.SignOut()
        }, ScriptedDesktopSignIn.StateKey)
    }

    // The account state (SignedIn, TenantName, Platform) as the renderer's account service reports it
    // now. Call after SignIn has located the services.
    public AccountState(win: Page): Promise<ScriptedAccountState>
    {
        return win.evaluate(async (stateKey) =>
        {
            const account = (window as any)[stateKey].account
            await account.Refresh()
            return {
                SignedIn: account.State.SignedIn === true, Email: account.State.Email,
                TenantName: account.State.TenantName, Platform: account.State.Platform,
            }
        }, ScriptedDesktopSignIn.StateKey)
    }

    // The sign-in targets (each row with its Id, Name, Status and Source), or the AccountError kind
    // when the call is refused (e.g. signed out).
    public Targets(win: Page): Promise<ScriptedTargets>
    {
        const S = ScriptedDesktopSignIn
        return win.evaluate(async (p) =>
        {
            // Each relay call is raced against a bounded timer so a hung relay fails the step, not the run.
            let timer: ReturnType<typeof setTimeout> | undefined
            const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject({ Kind: p.timedOutKind }), p.timeoutMs) })
            try
            {
                return { Targets: await Promise.race([(window as any)[p.stateKey].account.Targets(), timeout]) }
            }
            catch (e)
            {
                return { ErrorKind: String((e as any)?.Kind ?? p.unknownKind) }
            }
            finally
            {
                clearTimeout(timer)
            }
        }, { stateKey: S.StateKey, unknownKind: S.UnknownErrorKind, timedOutKind: S.TimedOutKind, timeoutMs: S.RelayCallTimeoutMs })
    }

    // Ends the current session now (the spec's own sign-out step); a later SignIn may follow.
    public async EndSession(win: Page): Promise<void>
    {
        await this.SignOutAccount(win)
    }

    private async InterceptOpener(app: ElectronApplication): Promise<void>
    {
        const replaced = await app.evaluate(({ shell }, key) =>
        {
            const g = globalThis as unknown as Record<string, { Original: typeof shell.openExternal; Urls: string[]; Replacement: typeof shell.openExternal } | undefined>
            if (g[key] === undefined)
            {
                const record = { Original: shell.openExternal, Urls: [] as string[], Replacement: shell.openExternal }
                record.Replacement = async (url: string): Promise<void> => { record.Urls.push(url) }
                g[key] = record
                shell.openExternal = record.Replacement
            }
            g[key]!.Urls.length = 0
            return shell.openExternal === g[key]!.Replacement
        }, ScriptedDesktopSignIn.OpenerKey)
        if (!replaced) throw new Error(ScriptedDesktopSignIn.NotIntercepted)
    }

    private async RestoreOpener(app: ElectronApplication): Promise<void>
    {
        await app.evaluate(({ shell }, key) =>
        {
            const g = globalThis as unknown as Record<string, { Original: typeof shell.openExternal } | undefined>
            const record = g[key]
            if (record === undefined) return
            shell.openExternal = record.Original
            delete g[key]
        }, ScriptedDesktopSignIn.OpenerKey).catch(() => undefined)
    }

    // Every URL the intercepted opener recorded since the interception.
    private OpenedUrls(app: ElectronApplication): Promise<string[]>
    {
        return app.evaluate((_electron, key) =>
        {
            const record = (globalThis as unknown as Record<string, { Urls: string[] } | undefined>)[key]
            return record === undefined ? [] : [...record.Urls]
        }, ScriptedDesktopSignIn.OpenerKey)
    }

    // Finds the dialog host, the account service and the settings (by ServiceKey description), keeps
    // them on a window-side state object, and loads the account state.
    private LocateServices(win: Page): Promise<LocateResult>
    {
        const S = ScriptedDesktopSignIn
        return win.evaluate(async (p) =>
        {
            const backref = Symbol.for(p.backref)
            const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
            const found: Record<string, any> = {}
            const deadline = Date.now() + p.timeoutMs
            while (found[p.hostKey] === undefined || found[p.accountKey] === undefined || found[p.settingsKey] === undefined)
            {
                for (const el of document.querySelectorAll('*'))
                {
                    const root = (el as any)[backref]
                    if (root?.Services === undefined) continue
                    for (let scope = root.Services; scope !== undefined; scope = scope._parent)
                    {
                        for (const [key, entry] of (scope._cache ?? new Map()))
                        {
                            const name = (key as any)?.description
                            if (typeof name === 'string' && found[name] === undefined) found[name] = entry
                        }
                    }
                    break
                }
                if (found[p.hostKey] !== undefined && found[p.accountKey] !== undefined && found[p.settingsKey] !== undefined) break
                if (Date.now() > deadline) return { Fault: p.noServices }
                await sleep(p.pollMs)
            }
            const account = found[p.accountKey]
            ;(window as any)[p.stateKey] = { host: found[p.hostKey], account, settings: found[p.settingsKey] }
            await account.Refresh()
            return { SignedIn: account.State?.SignedIn === true }
        }, {
            backref: S.VisualBackref, hostKey: S.DialogHostKey, accountKey: S.AccountKey, settingsKey: S.SettingsKey,
            stateKey: S.StateKey, noServices: S.NoServices, timeoutMs: S.OpenTimeoutMs, pollMs: S.PollMs,
        })
    }

    // Raises the sign-in request (the account dialog opens), enters the email and presses Continue.
    private async OpenDialogAndContinue(win: Page, consoleAddress: string | undefined): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        const fault = await win.evaluate((p) =>
        {
            const state: any = (window as any)[p.stateKey]
            // The dialog reads its address from the setting when it opens. The setting lives in the
            // isolated e2e profile, so writing it touches nothing of the developer's.
            if (p.platformAddress !== undefined)
            {
                state.settings.Set(p.addressSetting, p.platformAddress)
                if (state.settings.Get(p.addressSetting) !== p.platformAddress) return p.noAddressSetting
            }
            // The real path: IAccountService.RequestSignIn opens the dialog for this request. The
            // previous request's outcome is cleared so only this request's counts.
            state.done = undefined
            state.dialog = undefined
            state.account.RequestSignIn().then((signedIn: boolean) => { state.done = signedIn }, () => { state.done = false })
            const dialog = state.host.CurrentDialog
            if (dialog === undefined) return p.noDialog
            state.dialog = dialog
            dialog.Email = p.email
            // UseConsoleAddress has no setter: its command switches the dialog to the typed address.
            if (p.consoleAddress !== undefined)
            {
                dialog.UseConsoleAddressCommand.Execute(undefined)
                dialog.ConsoleAddress = p.consoleAddress
            }
            if (!dialog.ContinueCommand.CanExecute(undefined)) return p.cannotContinue
            dialog.ContinueCommand.Execute(undefined)
            return undefined
        }, {
            stateKey: S.StateKey, email: this.email, platformAddress: this.platformAddress, consoleAddress,
            addressSetting: S.PlatformAddressSetting, noAddressSetting: S.NoAddressSetting,
            noDialog: S.NoDialog, cannotContinue: S.CannotContinue,
        })
        if (fault !== undefined) throw new Error(fault)
    }

    // Polls the main process for the recorded authorize URL; meanwhile answers the tenant chooser
    // and fails fast when the dialog fell back to Email with a message (e.g. no account).
    private async AwaitAuthorizeUrl(app: ElectronApplication, win: Page): Promise<string>
    {
        const S = ScriptedDesktopSignIn
        const deadline = Date.now() + S.OpenTimeoutMs
        for (;;)
        {
            const url = SignInChecks.FirstAuthorizeUrl(await this.OpenedUrls(app))
            if (url !== undefined) return url
            const probe = await this.Probe(win)
            if (probe.Open && probe.Step === AccountDialogStep.ChooseTenant) await this.ChooseTenant(win, probe.Tenants ?? [])
            if (probe.Step === AccountDialogStep.Email && probe.Message) throw new Error(S.DialogFailedPrefix + probe.Message)
            // A failed platform sign-in returns to SignedIn with its sentence.
            if (probe.Step === AccountDialogStep.SignedIn && probe.Message) throw new Error(S.DialogFailedPrefix + probe.Message)
            if (probe.Done === false) throw new Error(S.DialogFailedPrefix + (probe.Message ?? ''))
            if (Date.now() > deadline) throw new Error(S.NoAuthorizeUrl)
            await win.waitForTimeout(S.PollMs)
        }
    }

    // Picks PLEXUS_E2E_TENANT (id or display name; failing when it matches none) or keeps the first,
    // then presses Continue.
    private async ChooseTenant(win: Page, tenants: readonly TenantRow[]): Promise<void>
    {
        const index = SignInChecks.PickTenant(tenants, this.tenant)
        await win.evaluate((p) =>
        {
            const dialog = (window as any)[p.stateKey]?.dialog
            if (dialog === undefined) return
            const wanted = dialog.Tenants[p.index]
            if (wanted !== undefined) dialog.SelectedTenant = wanted
            if (dialog.ContinueCommand.CanExecute(undefined)) dialog.ContinueCommand.Execute(undefined)
        }, { stateKey: ScriptedDesktopSignIn.StateKey, index })
    }

    // Resolves once the dialog's request resolved signed in, or once the account is signed in and the
    // dialog stopped on PlatformOffer (SignInAtPlatform or SkipPlatform then closes it).
    private async AwaitSignedIn(win: Page): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        const deadline = Date.now() + S.SignedInTimeoutMs
        for (;;)
        {
            const probe = await this.Probe(win)
            if (probe.Done === true && probe.SignedIn === true) return
            if (probe.SignedIn === true && probe.Step === AccountDialogStep.PlatformOffer) return
            if (probe.Done === false) throw new Error(S.DialogFailedPrefix + (probe.Message ?? S.NotSignedIn))
            if (Date.now() > deadline) throw new Error(probe.Message ? S.DialogFailedPrefix + probe.Message : S.NotSignedIn)
            await win.waitForTimeout(S.PollMs)
        }
    }

    // Resolves once the dialog's request resolved signed in and `also` holds for the probe; fails on
    // a request resolved false, on a sentence on the SignedIn step, or at the timeout with `timedOut`.
    private async AwaitDone(win: Page, timedOut: string, also: (probe: DialogProbe) => boolean): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        const deadline = Date.now() + S.SignedInTimeoutMs
        for (;;)
        {
            const probe = await this.Probe(win)
            if (probe.Done === true && probe.SignedIn === true && also(probe)) return
            if (probe.Done === false) throw new Error(S.DialogFailedPrefix + (probe.Message ?? timedOut))
            if (probe.Open && probe.Step === AccountDialogStep.SignedIn && probe.Message) throw new Error(S.DialogFailedPrefix + probe.Message)
            if (Date.now() > deadline) throw new Error(probe.Message ? S.DialogFailedPrefix + probe.Message : timedOut)
            await win.waitForTimeout(S.PollMs)
        }
    }

    // The dialog's step + message (AccountError sentences only: safe to print), its tenant list, the
    // request outcome and the account's signed-in state.
    private Probe(win: Page): Promise<DialogProbe>
    {
        return win.evaluate((stateKey) =>
        {
            const state = (window as any)[stateKey]
            if (state === undefined) return { Open: false }
            const dialog = state.host.CurrentDialog
            return {
                Open: dialog !== undefined,
                Step: state.dialog?.Step,
                Message: state.dialog?.Message || undefined,
                Done: state.done,
                SignedIn: state.account.State?.SignedIn === true,
                Platform: state.account.State?.Platform,
                Tenants: (state.dialog?.Tenants ?? []).map((t: any) => ({ Id: t.Id, DisplayName: t.DisplayName })),
            }
        }, ScriptedDesktopSignIn.StateKey)
    }

    private static Value(env: NodeJS.ProcessEnv, name: string): string | undefined
    {
        const value = env[name]?.trim()
        return value === undefined || value === '' ? undefined : value
    }
}
