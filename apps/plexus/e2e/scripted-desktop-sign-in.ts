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
//   4. It waits until the account reports signed in and the dialog's request resolved true.
// SignOut() ends the session this helper created (call it before closing the app); the profile's
// Dispose() then deletes what is left on disk.
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
import { readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from 'playwright'
import { AccountDialogStep } from '../src/renderer/src/modules/account/account-dialog-step'
import { IdpPasswordLogin } from './support/idp-password-login'
import type { E2eProfile } from './support/e2e-profile'
import { SignInChecks, type TenantRow } from './support/sign-in-checks'

// The dialog's progress as the renderer reports it to the node side.
interface DialogProbe
{
    Open: boolean
    Step?: string
    Message?: string
    Done?: boolean
    SignedIn?: boolean
    Tenants?: TenantRow[]
}

// What locating the services found: a fault sentence, or whether the profile is signed in.
interface LocateResult
{
    Fault?: string
    SignedIn?: boolean
}

export class ScriptedDesktopSignIn
{
    public static readonly EmailEnv = 'PLEXUS_E2E_OWNER_EMAIL'
    public static readonly PasswordFileEnv = 'PLEXUS_E2E_OWNER_PASSWORD_FILE'
    public static readonly PlatformAddressEnv = 'PLEXUS_E2E_PLATFORM_ADDRESS'
    public static readonly TenantEnv = 'PLEXUS_E2E_TENANT'
    public static readonly IdpCaFileEnv = 'PLEXUS_E2E_IDP_CA_FILE'
    public static readonly SkipMessage =
        `needs a scripted desktop sign-in: set ${ScriptedDesktopSignIn.EmailEnv} (account email) and `
        + `${ScriptedDesktopSignIn.PasswordFileEnv} (path of a file holding its password)`

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

    // Whether this instance signed the app in (and so may sign it out).
    private createdSession = false

    private constructor(
        private readonly email: string,
        private readonly password: string,
        private readonly platformAddress: string | undefined,
        private readonly tenant: string | undefined,
        private readonly login: IdpPasswordLogin,
    )
    {
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
        const login = new IdpPasswordLogin(caFile === undefined ? undefined : readFileSync(caFile))
        return new ScriptedDesktopSignIn(email, password, S.Value(env, S.PlatformAddressEnv), S.Value(env, S.TenantEnv), login)
    }

    // Signs the app (launched on `profile`) in; resolves once the account reports signed in.
    public async SignIn(app: ElectronApplication, win: Page, profile: E2eProfile): Promise<void>
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
            await this.OpenDialogAndContinue(win)
            const authorizeUrl = await this.AwaitAuthorizeUrl(app, win)
            await this.login.Run(authorizeUrl, this.email, this.password)
            await this.AwaitSignedIn(win)
            this.createdSession = true
        }
        finally
        {
            await this.RestoreOpener(app)
        }
    }

    // Ends the session this helper created (no-op otherwise), so the owner token does not stay live
    // on the tenant plane after the run.
    public async SignOut(win: Page): Promise<void>
    {
        if (!this.createdSession) return
        this.createdSession = false
        await win.evaluate(async (stateKey) =>
        {
            const account = (window as any)[stateKey]?.account
            if (account?.State?.SignedIn) await account.SignOut()
        }, ScriptedDesktopSignIn.StateKey)
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
    private async OpenDialogAndContinue(win: Page): Promise<void>
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
            // The real path: IAccountService.RequestSignIn opens the dialog for this request.
            state.account.RequestSignIn().then((signedIn: boolean) => { state.done = signedIn }, () => { state.done = false })
            const dialog = state.host.CurrentDialog
            if (dialog === undefined) return p.noDialog
            state.dialog = dialog
            dialog.Email = p.email
            if (!dialog.ContinueCommand.CanExecute(undefined)) return p.cannotContinue
            dialog.ContinueCommand.Execute(undefined)
            return undefined
        }, {
            stateKey: S.StateKey, email: this.email, platformAddress: this.platformAddress,
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
            const urls = await app.evaluate((_electron, key) =>
            {
                const record = (globalThis as unknown as Record<string, { Urls: string[] } | undefined>)[key]
                return record === undefined ? [] : [...record.Urls]
            }, S.OpenerKey)
            const url = SignInChecks.FirstAuthorizeUrl(urls)
            if (url !== undefined) return url
            const probe = await this.Probe(win)
            if (probe.Open && probe.Step === AccountDialogStep.ChooseTenant) await this.ChooseTenant(win, probe.Tenants ?? [])
            if (probe.Step === AccountDialogStep.Email && probe.Message) throw new Error(S.DialogFailedPrefix + probe.Message)
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

    private async AwaitSignedIn(win: Page): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        const deadline = Date.now() + S.SignedInTimeoutMs
        for (;;)
        {
            const probe = await this.Probe(win)
            if (probe.Done === true && probe.SignedIn === true) return
            if (probe.Done === false) throw new Error(S.DialogFailedPrefix + (probe.Message ?? S.NotSignedIn))
            if (Date.now() > deadline) throw new Error(probe.Message ? S.DialogFailedPrefix + probe.Message : S.NotSignedIn)
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
