// The realm leg of the live loop's scripted sign-in (pragmatic-e2e `live-loop-stack.ts up --sign-in realm`,
// spec 2026-11-20-e S1-S6). The stack's console names its tenant realm in /desktop/console, so Plexus's
// own account service signs in at the realm as the public client `plexus`: ScriptedDesktopSignIn drives the
// dialog and the browser login exactly as for the transitional path, and this class holds what makes the
// run a realm run.
//
//   - Before launch: Plexus's main process must trust the stack's private CAs (the TLS front the console
//     is reached through, and the realm's sign-in service it calls for discovery, tokens and revocation),
//     so the launch gets NODE_EXTRA_CA_CERTS = the stack's desktop CA bundle (stack.json desktopCaFile).
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
    private static readonly AuthorizeSuffix = '/protocol/openid-connect/auth'
    private static readonly ClientIdParam = 'client_id'
    private static readonly ChallengeMethodParam = 'code_challenge_method'
    private static readonly ScopeParam = 'scope'
    private static readonly S256 = 'S256'
    private static readonly OfflineScope = 'offline_access'
    private static readonly ScopeSeparator = ' '
    private static readonly NoIssuer = 'realm sign-in: the stack names no realm issuer (PLEXUS_E2E_REALM_ISSUER / stack.json realmIssuer)'
    private static readonly NoCaBundle = 'realm sign-in: the stack names no desktop CA bundle (PLEXUS_E2E_DESKTOP_CA_FILE / stack.json desktopCaFile)'
    private static readonly NotRealmPrefix = 'realm sign-in: Plexus did not sign in at the realm: '
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
        if (issuer === undefined || issuer === '') throw new Error(S.NoIssuer)
        if (bundle === undefined || bundle === '') throw new Error(S.NoCaBundle)
        return new ScriptedRealmSignIn(issuer, bundle)
    }

    // The launch environment: Plexus's main process trusts the stack's CAs (set before launchPlexus copies it).
    public TrustFor(env: NodeJS.ProcessEnv): void
    {
        env[ScriptedRealmSignIn.CaEnv] = this.CaBundleFile
    }

    // Throws unless `authorizeUrl` is this realm's authorize request for plexus (S256, offline_access).
    public CheckAuthorizeUrl(authorizeUrl: string): void
    {
        const S = ScriptedRealmSignIn
        const url = new URL(authorizeUrl)
        const fault = url.origin + url.pathname !== this.Issuer + S.AuthorizeSuffix ? S.WrongEndpoint
            : url.searchParams.get(S.ClientIdParam) !== S.ClientId ? S.WrongClient
                : url.searchParams.get(S.ChallengeMethodParam) !== S.S256 ? S.NoPkce
                    : !(url.searchParams.get(S.ScopeParam) ?? '').split(S.ScopeSeparator).includes(S.OfflineScope) ? S.NoOffline
                        : undefined
        if (fault !== undefined) throw new Error(S.NotRealmPrefix + fault)
    }
}
