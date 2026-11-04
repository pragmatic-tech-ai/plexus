// Browser-less IdP password login for the e2e desktop sign-in, mirroring the server's
// admin/control-plane/desktop-sign-in-smoke.ts RunLogin: GET the authorize URL (keep the session
// cookie), POST the password form (email, password) to the same URL without following redirects,
// then follow the redirect to the Plexus loopback callback so its receiver completes the sign-in.
//
// TLS: the IdP serves with a private dev CA. As the server's idp-sso-smoke does, the CA is handed to
// each HTTPS request in-process (node:https `{ ca }`) when a CA file is given, ADDED to Node's bundled
// root certificates so a publicly trusted IdP still verifies; NODE_EXTRA_CA_CERTS is not required.
// The authorize URL must be https unless the IdP is on a loopback host: the password is posted to it.
//
// Authorize page: like a browser, the GET follows ONE same-origin redirect (an IdP that answers the
// authorize URL with a 302 to its login page); the form is then posted to that page, with every
// cookie both answers set.
//
// Secret hygiene: the password only ever goes into the form body. Errors carry statuses and fixed
// sentences, never the password, the cookie, the code or the callback URL.
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { rootCertificates } from 'node:tls'

// One HTTP answer: what the login needs of it, nothing more.
export interface IdpHttpAnswer
{
    Status: number
    SetCookie: readonly string[]
    Location: string | undefined
}

// Failure of one step of the scripted login. The message is safe to print.
export class IdpLoginError extends Error
{
    private static readonly ErrorName = 'IdpLoginError'

    public constructor(message: string)
    {
        super(message)
        this.name = IdpLoginError.ErrorName
    }
}

export class IdpPasswordLogin
{
    public static readonly CallbackPath = '/pragmatic-desktop/callback'
    private static readonly LoopbackHosts: readonly string[] = ['127.0.0.1', 'localhost', '[::1]']
    private static readonly HttpScheme = 'http:'
    private static readonly HttpsScheme = 'https:'
    private static readonly MethodGet = 'GET'
    private static readonly MethodPost = 'POST'
    private static readonly HeaderContentType = 'content-type'
    private static readonly HeaderCookie = 'cookie'
    private static readonly HeaderSetCookie = 'set-cookie'
    private static readonly FormType = 'application/x-www-form-urlencoded'
    private static readonly EmailField = 'email'
    private static readonly PasswordField = 'password'
    private static readonly CodeParam = 'code'
    private static readonly StateParam = 'state'
    private static readonly ErrorParam = 'error'
    private static readonly CookieSeparator = '; '
    private static readonly AttributeSeparator = ';'
    private static readonly NameValueSeparator = '='
    private static readonly EventError = 'error'
    private static readonly EventTimeout = 'timeout'
    private static readonly DefaultTimeoutMs = 30_000
    private static readonly StatusOk = 200
    private static readonly RedirectMin = 300
    private static readonly RedirectMax = 399
    private static readonly ErrorMin = 400
    private static readonly AuthorizePageFailed = 'IdP authorize page did not load, status '
    private static readonly NoCookie = 'IdP authorize page set no session cookie'
    private static readonly NotRedirected = 'IdP login did not redirect, status '
    private static readonly BadLocation = 'IdP login redirected somewhere other than the Plexus loopback callback'
    private static readonly IdpRefused = 'IdP login redirected to the loopback callback with an error instead of a code'
    private static readonly MissingCode = 'IdP login redirected to the loopback callback without a code and state'
    private static readonly CallbackFailed = 'Plexus loopback callback refused the code, status '
    private static readonly UnsupportedScheme = 'authorize URL is not http(s)'
    private static readonly Insecure = 'authorize URL must be https unless the IdP is on a loopback host (the password is posted to it)'
    private static readonly TimedOut = 'IdP request timed out'

    public constructor(
        private readonly ca: Buffer | undefined = undefined,
        private readonly timeoutMs: number = IdpPasswordLogin.DefaultTimeoutMs,
    )
    {
    }

    // Runs the whole login against `authorizeUrl`; resolves once the loopback callback accepted the code.
    public async Run(authorizeUrl: string, email: string, password: string): Promise<void>
    {
        const S = IdpPasswordLogin
        const authorize = S.ParseAuthorizeUrl(authorizeUrl)
        let formUrl = authorize.toString()
        const setCookies: string[] = []
        let page = await this.Request(formUrl, S.MethodGet)
        setCookies.push(...page.SetCookie)
        const next = S.SameOriginRedirect(page, authorize)
        if (next !== undefined)
        {
            formUrl = next
            const replay = S.CookieHeader(setCookies)
            page = await this.Request(formUrl, S.MethodGet, replay === '' ? {} : { [S.HeaderCookie]: replay })
            setCookies.push(...page.SetCookie)
        }
        if (page.Status !== S.StatusOk) throw new IdpLoginError(S.AuthorizePageFailed + String(page.Status))
        const cookie = S.CookieHeader(setCookies)
        if (cookie === '') throw new IdpLoginError(S.NoCookie)
        const form = await this.Request(formUrl, S.MethodPost, {
            [S.HeaderContentType]: S.FormType,
            [S.HeaderCookie]: cookie,
        }, S.FormBody(email, password))
        const callback = S.LoopbackCallback(form)
        const done = await this.Request(callback.toString(), S.MethodGet)
        if (done.Status >= S.ErrorMin) throw new IdpLoginError(S.CallbackFailed + String(done.Status))
    }

    // Whether the password may be posted to `url`: https, or http on a loopback host only.
    public static IsSecureEnough(url: URL): boolean
    {
        const S = IdpPasswordLogin
        if (url.protocol === S.HttpsScheme) return true
        return url.protocol === S.HttpScheme && S.IsLoopback(url)
    }

    // The CA list for an https request: Node's bundled roots plus the dev CA, or undefined (Node's
    // default trust) when no CA was given. Passing `ca` alone would REPLACE the default trust.
    public static TrustFor(ca: Buffer | undefined): string[] | undefined
    {
        return ca === undefined ? undefined : [...rootCertificates, ca.toString()]
    }

    // The Cookie request header that replays every cookie the authorize page set (name=value only).
    public static CookieHeader(setCookie: readonly string[]): string
    {
        return setCookie
            .map((c) => (c.split(IdpPasswordLogin.AttributeSeparator)[0] ?? '').trim())
            .filter((pair) => pair.includes(IdpPasswordLogin.NameValueSeparator))
            .join(IdpPasswordLogin.CookieSeparator)
    }

    // The urlencoded password form body the IdP login page posts.
    public static FormBody(email: string, password: string): string
    {
        return new URLSearchParams({
            [IdpPasswordLogin.EmailField]: email,
            [IdpPasswordLogin.PasswordField]: password,
        }).toString()
    }

    // The loopback callback the form answer redirects to. Throws unless the answer is a redirect to an
    // http loopback host on the Plexus callback path carrying a code and a state (no error).
    public static LoopbackCallback(answer: IdpHttpAnswer): URL
    {
        const S = IdpPasswordLogin
        if (answer.Status < S.RedirectMin || answer.Status > S.RedirectMax || answer.Location === undefined)
        {
            throw new IdpLoginError(S.NotRedirected + String(answer.Status))
        }
        let url: URL
        try
        {
            url = new URL(answer.Location)
        }
        catch
        {
            throw new IdpLoginError(S.BadLocation)
        }
        if (url.protocol !== S.HttpScheme || !S.IsLoopback(url) || url.pathname !== S.CallbackPath)
        {
            throw new IdpLoginError(S.BadLocation)
        }
        if (url.searchParams.has(S.ErrorParam)) throw new IdpLoginError(S.IdpRefused)
        const code = url.searchParams.get(S.CodeParam)
        const state = url.searchParams.get(S.StateParam)
        if (code === null || code === '' || state === null || state === '') throw new IdpLoginError(S.MissingCode)
        return url
    }

    private static ParseAuthorizeUrl(authorizeUrl: string): URL
    {
        const S = IdpPasswordLogin
        let url: URL
        try
        {
            url = new URL(authorizeUrl)
        }
        catch
        {
            throw new IdpLoginError(S.UnsupportedScheme)
        }
        if (url.protocol !== S.HttpScheme && url.protocol !== S.HttpsScheme) throw new IdpLoginError(S.UnsupportedScheme)
        if (!S.IsSecureEnough(url)) throw new IdpLoginError(S.Insecure)
        return url
    }

    // The Location of a redirect answer when it stays on the authorize URL's origin, else undefined.
    private static SameOriginRedirect(answer: IdpHttpAnswer, origin: URL): string | undefined
    {
        const S = IdpPasswordLogin
        if (answer.Status < S.RedirectMin || answer.Status > S.RedirectMax || answer.Location === undefined) return undefined
        try
        {
            return new URL(answer.Location).origin === origin.origin ? answer.Location : undefined
        }
        catch
        {
            return undefined
        }
    }

    private static IsLoopback(url: URL): boolean
    {
        const S = IdpPasswordLogin
        return S.LoopbackHosts.includes(url.hostname)
    }

    // One request, redirects never followed; https requests carry the dev CA when one was given.
    private Request(url: string, method: string, headers: Record<string, string> = {}, body?: string): Promise<IdpHttpAnswer>
    {
        const S = IdpPasswordLogin
        const target = new URL(url)
        if (target.protocol !== S.HttpScheme && target.protocol !== S.HttpsScheme)
        {
            return Promise.reject(new IdpLoginError(S.UnsupportedScheme))
        }
        return new Promise((resolve, reject) =>
        {
            const onAnswer = (res: IncomingMessage): void =>
            {
                res.resume()
                resolve({ Status: res.statusCode ?? 0, SetCookie: S.SetCookieOf(res.headers), Location: S.LocationOf(res.headers, target) })
            }
            const options = { method, headers, timeout: this.timeoutMs }
            const trust = S.TrustFor(this.ca)
            const req = target.protocol === S.HttpsScheme
                ? httpsRequest(target, trust === undefined ? options : { ...options, ca: trust }, onAnswer)
                : httpRequest(target, options, onAnswer)
            req.on(S.EventTimeout, () => req.destroy(new IdpLoginError(S.TimedOut)))
            req.on(S.EventError, reject)
            req.end(body)
        })
    }

    private static SetCookieOf(headers: IncomingHttpHeaders): readonly string[]
    {
        return headers[IdpPasswordLogin.HeaderSetCookie] ?? []
    }

    // A relative Location resolves against the request URL, as a browser would.
    private static LocationOf(headers: IncomingHttpHeaders, base: URL): string | undefined
    {
        const location = headers.location
        if (location === undefined) return undefined
        try
        {
            return new URL(location, base).toString()
        }
        catch
        {
            return location
        }
    }
}
