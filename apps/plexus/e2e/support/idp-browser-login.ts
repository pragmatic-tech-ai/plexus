// Browser IdP login for the e2e desktop sign-in, for IdPs that serve a JavaScript single-page login
// (the in-hive tenant IdP) where no server-side form exists for IdpPasswordLogin to post.
//
// A separate headless Chromium (NOT the Electron app) opens the authorize URL, waits for the login
// page's email field, types the email and the password, presses Enter, and waits until the browser
// reaches the Plexus loopback callback (the redirect URI in the authorize URL) so Plexus's own
// receiver completes the sign-in. The field selectors are the ones the server's live smokes use
// (admin/control-plane/idp-login-page.ts there); they are repeated here, not imported across repos.
//
// TLS: ignoreHTTPSErrors is NOT set. Chromium on Windows trusts the OS root store, where the dev CA
// is installed, so the run proves that trust.
//
// Secret hygiene: no tracing, no video, no screenshots (also none on failure). The password only goes
// into the field. Errors name the failed step only, never the underlying error text or any URL.
import { chromium, type LaunchOptions, type Page } from 'playwright'
import { TransportRule } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IIdpLogin } from '../scripted-desktop-sign-in'
import { IdpLoginError, IdpPasswordLogin } from './idp-password-login'

// The navigation event a step waits for (Playwright's waitUntil union).
type WaitUntil = NonNullable<NonNullable<Parameters<Page['goto']>[1]>['waitUntil']>

export class IdpBrowserLogin implements IIdpLogin
{
    private static readonly EmailSelector = 'input[autocomplete="email"]'
    private static readonly PasswordSelector = 'input[autocomplete="current-password"]'
    private static readonly HttpScheme = 'http:'
    private static readonly SubmitKey = 'Enter'
    // Navigation counts as reached once the response starts (the callback page itself may never load).
    private static readonly WaitUntil: WaitUntil = 'commit'
    private static readonly Launch: LaunchOptions = { headless: true }
    private static readonly StepTimeoutMs = 60_000
    private static readonly OpenFailed = 'IdP browser login: the authorize page did not open'
    private static readonly NoLoginForm = 'IdP browser login: the login form did not show within the timeout'
    private static readonly SubmitFailed = 'IdP browser login: the credentials could not be entered'
    private static readonly NoCallback = 'IdP browser login: the browser did not reach the Plexus loopback callback within the timeout'

    // Runs the whole login against `authorizeUrl`; resolves once the browser reached the loopback callback.
    public async Run(authorizeUrl: string, email: string, password: string): Promise<void>
    {
        const S = IdpBrowserLogin
        const browser = await chromium.launch(S.Launch)
        try
        {
            const page = await (await browser.newContext()).newPage()
            await S.Step(S.OpenFailed, () => page.goto(authorizeUrl, { waitUntil: S.WaitUntil, timeout: S.StepTimeoutMs }))
            await S.Step(S.NoLoginForm, () => page.waitForSelector(S.EmailSelector, { timeout: S.StepTimeoutMs }))
            await S.Step(S.SubmitFailed, async () =>
            {
                await page.fill(S.EmailSelector, email)
                await page.fill(S.PasswordSelector, password)
                await page.press(S.PasswordSelector, S.SubmitKey)
            })
            await S.Step(S.NoCallback, () => page.waitForURL((url) => S.IsCallback(url), { timeout: S.StepTimeoutMs, waitUntil: S.WaitUntil }))
        }
        finally
        {
            await browser.close().catch(() => undefined)
        }
    }

    // Whether `url` is the Plexus loopback callback (http, loopback host, callback path).
    public static IsCallback(url: URL): boolean
    {
        const S = IdpBrowserLogin
        return url.protocol === S.HttpScheme && TransportRule.IsLoopback(url) && url.pathname === IdpPasswordLogin.CallbackPath
    }

    // Runs one step; a failure becomes an IdpLoginError naming the step only.
    private static async Step(failure: string, action: () => Promise<unknown>): Promise<void>
    {
        try
        {
            await action()
        }
        catch
        {
            throw new IdpLoginError(failure)
        }
    }
}
