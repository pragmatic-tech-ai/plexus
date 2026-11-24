// The realm leg of the live loop's scripted sign-in (pragmatic-e2e `live-loop-stack.ts up --sign-in realm`,
// spec 2026-11-20-e S1-S6). The stack's console names its tenant realm in /desktop/console, so Plexus's
// own account service signs in at the realm as the public client `plexus`: ScriptedDesktopSignIn drives the
// dialog and the browser login exactly as for the transitional path, and this class holds what makes the
// run a realm run.
//
//   - At launch: Plexus's main process must trust the stack's private CAs (the TLS front the console
//     is reached through, and the realm's sign-in service it calls for discovery, tokens and revocation),
//     so the app is launched with NODE_EXTRA_CA_CERTS = the stack's desktop CA bundle (stack.json desktopCaFile).
//   - After sign-in: the authorize URL Plexus opened must be the realm's own (on its issuer, client_id
//     `plexus`, S256, offline_access), never the console-brokered begin; a transitional fallback (the
//     console named no realm, or its lookup failed) therefore fails the run instead of passing silently.
//
// Inputs come from the stack descriptor through E2eStackInputs (PLEXUS_E2E_SIGN_IN, PLEXUS_E2E_REALM_ISSUER,
// PLEXUS_E2E_DESKTOP_CA_FILE); without `signIn: realm` the spec runs the transitional path unchanged.
import { E2eStackInputs } from './e2e-stack-inputs'

// The sign-in modes a stack descriptor names (pragmatic-e2e LiveLoopSignIn).
export enum E2eSignInMode
{
    Realm = 'realm',
    Transitional = 'transitional',
}

export class ScriptedRealmSignIn
{
    public static readonly ClientId = 'plexus'
    public static readonly CaEnv = 'NODE_EXTRA_CA_CERTS'
    public static readonly AuthorizeSuffix = '/protocol/openid-connect/auth'
    private static readonly ClientIdParam = 'client_id'
    private static readonly ChallengeMethodParam = 'code_challenge_method'
    private static readonly ScopeParam = 'scope'
    private static readonly S256 = 'S256'
    private static readonly OfflineScope = 'offline_access'
    private static readonly ScopeSeparator = ' '
    private static readonly NoText = ''
    private static readonly TrailingSlashes = /\/+$/
    private static readonly NoIssuer = 'realm sign-in: the stack names no realm issuer (PLEXUS_E2E_REALM_ISSUER / stack.json realmIssuer)'
    private static readonly NoCaBundle = 'realm sign-in: the stack names no desktop CA bundle (PLEXUS_E2E_DESKTOP_CA_FILE / stack.json desktopCaFile)'
    private static readonly CaConflictPrefix = 'realm sign-in: NODE_EXTRA_CA_CERTS is already set to another bundle; unset it for the run or point it at '
    private static readonly NotRealmPrefix = 'realm sign-in: Plexus did not sign in at the realm: '
    private static readonly NoAuthorizeUrl = 'no authorize URL was opened'
    private static readonly WrongEndpoint = 'the authorize URL is not the realm authorization endpoint'
    private static readonly WrongClient = 'the authorize URL names another client'
    private static readonly NoPkce = 'the authorize URL asks no S256 challenge'
    private static readonly NoOffline = 'the authorize URL asks no offline_access'

    private constructor(public readonly Issuer: string, public readonly CaBundleFile: string)
    {
    }

    // The realm leg when the stack runs in realm mode; undefined for a transitional stack.
    public static FromEnvironment(raw: NodeJS.ProcessEnv = process.env): ScriptedRealmSignIn | undefined
    {
        const S = ScriptedRealmSignIn
        const env = E2eStackInputs.Apply(raw)
        if (env[E2eStackInputs.SignInEnv] !== E2eSignInMode.Realm) return undefined
        const issuer = env[E2eStackInputs.RealmIssuerEnv]
        const bundle = env[E2eStackInputs.DesktopCaFileEnv]
        if (issuer === undefined || issuer === S.NoText) throw new Error(S.NoIssuer)
        if (bundle === undefined || bundle === S.NoText) throw new Error(S.NoCaBundle)
        return new ScriptedRealmSignIn(issuer, bundle)
    }

    // What the app is launched with on top of the runner's environment (launchPlexus's extraEnv): its main
    // process trusts the stack's CAs. A different bundle already set in `env` is refused (the run would
    // trust one or the other silently); the runner's own environment is never changed.
    public LaunchEnv(env: NodeJS.ProcessEnv): Record<string, string>
    {
        const S = ScriptedRealmSignIn
        const current = env[S.CaEnv]
        if (current !== undefined && current !== S.NoText && current !== this.CaBundleFile)
        {
            throw new Error(S.CaConflictPrefix + this.CaBundleFile)
        }
        return { [S.CaEnv]: this.CaBundleFile }
    }

    // Throws unless `authorizeUrl` is this realm's authorize request for plexus (S256, offline_access).
    public CheckAuthorizeUrl(authorizeUrl: string | undefined): void
    {
        const S = ScriptedRealmSignIn
        if (authorizeUrl === undefined || authorizeUrl === S.NoText)
        {
            throw new Error(S.NotRealmPrefix + S.NoAuthorizeUrl)
        }
        const url = new URL(authorizeUrl)
        const expected = new URL(this.Issuer.replace(S.TrailingSlashes, S.NoText) + S.AuthorizeSuffix)
        if (url.origin !== expected.origin || url.pathname !== expected.pathname)
        {
            throw new Error(S.NotRealmPrefix + S.WrongEndpoint)
        }
        if (url.searchParams.get(S.ClientIdParam) !== S.ClientId)
        {
            throw new Error(S.NotRealmPrefix + S.WrongClient)
        }
        if (url.searchParams.get(S.ChallengeMethodParam) !== S.S256)
        {
            throw new Error(S.NotRealmPrefix + S.NoPkce)
        }
        if (!(url.searchParams.get(S.ScopeParam) ?? S.NoText).split(S.ScopeSeparator).includes(S.OfflineScope))
        {
            throw new Error(S.NotRealmPrefix + S.NoOffline)
        }
    }
}
