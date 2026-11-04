// Scripted desktop sign-in for the live e2e specs: signs the launched Plexus in to its account
// WITHOUT a real browser, through the app's real sign-in path.
//
//   1. The main process's browser opener is intercepted: AccountService opens the authorize URL
//      through `shell.openExternal` (src/main/index.ts), so the helper replaces that function in the
//      Electron main process (electronApp.evaluate) with one that records the URL instead of opening
//      a browser. The original is put back afterwards.
//   2. The sign-in starts exactly as a picker's "Sign in" does: IAccountService.RequestSignIn() opens
//      the account dialog (AccountDialogHost), and the helper drives the dialog view model: Email,
//      then its ContinueCommand (discover -> tenant chooser -> sign in -> waiting on the browser).
//   3. The recorded authorize URL is driven over HTTP by IdpPasswordLogin (the server smoke's
//      RunLogin: GET, keep the cookie, POST the password form, follow the redirect to the loopback
//      callback), so Plexus's own loopback receiver completes the sign-in and stores the session.
//   4. It waits until the account reports signed in and the dialog's request resolved true.
// A session left by an earlier run is signed out first, so the configured account is the one used.
//
// Inputs (environment variables):
//   PLEXUS_E2E_OWNER_EMAIL          account email to sign in with (required)
//   PLEXUS_E2E_OWNER_PASSWORD_FILE  path of a file holding that account's password (required; read,
//                                   never printed)
//   PLEXUS_E2E_PLATFORM_ADDRESS     platform address for this sign-in (optional; default: the app's
//                                   account.platformAddress setting, itself defaulting to
//                                   http://localhost:7000)
//   PLEXUS_E2E_TENANT               tenant id or display name to pick when the email belongs to
//                                   several tenants (optional; default: the first one listed)
//   PLEXUS_E2E_IDP_CA_FILE          the IdP's dev CA certificate (optional; for an https IdP with a
//                                   private CA; else Node's default trust incl. NODE_EXTRA_CA_CERTS)
import { readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from 'playwright'
import { IdpPasswordLogin } from './support/idp-password-login'

// The dialog's progress as the renderer reports it to the node side.
interface DialogProbe
{
    Open: boolean
    Step?: string
    Message?: string
    Done?: boolean
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
    private static readonly DialogHostName = 'AccountDialogHost'
    private static readonly StepEmail = 'email'
    private static readonly StepChooseTenant = 'choose-tenant'
    private static readonly Utf8 = 'utf8'
    private static readonly PollMs = 250
    private static readonly OpenTimeoutMs = 60_000
    private static readonly SignedInTimeoutMs = 60_000
    private static readonly NotIntercepted = 'could not replace shell.openExternal in the Electron main process'
    private static readonly NoDialog = 'the account dialog did not open (no AccountDialogHost, or a dialog was already open)'
    private static readonly CannotContinue = 'the account dialog cannot continue: Continue is disabled'
    private static readonly NoAuthorizeUrl = 'the app never opened an authorize URL within the timeout'
    private static readonly DialogFailedPrefix = 'the account dialog reported: '
    private static readonly NotSignedIn = 'the account did not report signed in after the loopback callback'
    private static readonly EmptyPassword = 'the password file is empty'

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

    // Signs the launched app in; resolves once the account reports signed in.
    public async SignIn(app: ElectronApplication, win: Page): Promise<void>
    {
        await this.InterceptOpener(app)
        try
        {
            await this.OpenDialogAndContinue(win)
            const authorizeUrl = await this.AwaitAuthorizeUrl(app, win)
            await this.login.Run(authorizeUrl, this.email, this.password)
            await this.AwaitSignedIn(win)
        }
        finally
        {
            await this.RestoreOpener(app)
        }
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

    // Raises the sign-in request (the account dialog opens), enters the email and presses Continue.
    private async OpenDialogAndContinue(win: Page): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        const fault = await win.evaluate(async (p) =>
        {
            const backref = Symbol.for(p.backref)
            const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
            let host: any
            const deadline = Date.now() + p.timeoutMs
            while (host === undefined)
            {
                for (const el of document.querySelectorAll('*'))
                {
                    const root = (el as any)[backref]
                    if (root?.Services === undefined) continue
                    for (let scope = root.Services; scope !== undefined && host === undefined; scope = scope._parent)
                    {
                        for (const [, entry] of (scope._cache ?? new Map()))
                        {
                            if ((entry as any)?.constructor?.name === p.hostName) host = entry
                        }
                    }
                    break
                }
                if (host === undefined)
                {
                    if (Date.now() > deadline) return p.noDialog
                    await sleep(p.pollMs)
                }
            }
            // A session stored by an earlier run would put the dialog straight on "Signed in as":
            // load the account state and sign out first, so this run signs in the configured account.
            await host.account.Refresh()
            if (host.account.State.SignedIn) await host.account.SignOut()
            const state: any = (window as any)[p.stateKey] = { host }
            // The real path: IAccountService.RequestSignIn opens the dialog for this request.
            host.account.RequestSignIn().then((signedIn: boolean) => { state.done = signedIn }, () => { state.done = false })
            if (host.openDialog === undefined) return p.noDialog
            const dialog = host.openDialog
            state.dialog = dialog
            // The dialog reads its address from Settings when it opens; an override replaces it for
            // this dialog only (TS-private, reachable at runtime), so no setting is persisted.
            if (p.platformAddress !== undefined) dialog.platformAddress = p.platformAddress
            dialog.Email = p.email
            if (!dialog.ContinueCommand.CanExecute(undefined)) return p.cannotContinue
            dialog.ContinueCommand.Execute(undefined)
            return undefined
        }, {
            backref: S.VisualBackref, hostName: S.DialogHostName, stateKey: S.StateKey, email: this.email,
            platformAddress: this.platformAddress, noDialog: S.NoDialog, cannotContinue: S.CannotContinue,
            timeoutMs: S.OpenTimeoutMs, pollMs: S.PollMs,
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
            const url = await app.evaluate((_electron, key) =>
            {
                const record = (globalThis as unknown as Record<string, { Urls: string[] } | undefined>)[key]
                return record?.Urls[0]
            }, S.OpenerKey)
            if (url !== undefined) return url
            const probe = await this.Probe(win)
            if (probe.Open && probe.Step === S.StepChooseTenant) await this.ChooseTenant(win)
            if (probe.Step === S.StepEmail && probe.Message) throw new Error(S.DialogFailedPrefix + probe.Message)
            if (probe.Done === false) throw new Error(S.DialogFailedPrefix + (probe.Message ?? ''))
            if (Date.now() > deadline) throw new Error(S.NoAuthorizeUrl)
            await win.waitForTimeout(S.PollMs)
        }
    }

    // Picks PLEXUS_E2E_TENANT (id or display name) or keeps the first, then presses Continue.
    private async ChooseTenant(win: Page): Promise<void>
    {
        const S = ScriptedDesktopSignIn
        await win.evaluate((p) =>
        {
            const dialog = (window as any)[p.stateKey]?.dialog
            if (dialog === undefined) return
            const wanted = p.tenant === undefined
                ? undefined
                : dialog.Tenants.find((t: any) => t.Id === p.tenant || t.DisplayName === p.tenant)
            if (wanted !== undefined) dialog.SelectedTenant = wanted
            if (dialog.ContinueCommand.CanExecute(undefined)) dialog.ContinueCommand.Execute(undefined)
        }, { stateKey: S.StateKey, tenant: this.tenant })
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

    // The dialog's step + message (AccountError sentences only: safe to print), the request outcome
    // and the account's signed-in state.
    private Probe(win: Page): Promise<DialogProbe>
    {
        return win.evaluate((stateKey) =>
        {
            const state = (window as any)[stateKey]
            if (state === undefined) return { Open: false }
            return {
                Open: state.host.openDialog !== undefined,
                Step: state.dialog?.Step,
                Message: state.dialog?.Message || undefined,
                Done: state.done,
                SignedIn: state.host.account.State?.SignedIn === true,
            }
        }, ScriptedDesktopSignIn.StateKey)
    }

    private static Value(env: NodeJS.ProcessEnv, name: string): string | undefined
    {
        const value = env[name]?.trim()
        return value === undefined || value === '' ? undefined : value
    }
}
