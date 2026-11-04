// Node-side decisions of the e2e scripted desktop sign-in, kept out of the renderer-driving code so
// they are unit-testable: which recorded URL is the authorize URL, which tenant to pick, and whether
// the launched profile may be signed in at all. Every failure message is a fixed sentence.

// A tenant as the account dialog lists it.
export interface TenantRow
{
    Id: string
    DisplayName: string
}

export class SignInCheckError extends Error
{
    private static readonly ErrorName = 'SignInCheckError'

    public constructor(message: string)
    {
        super(message)
        this.name = SignInCheckError.ErrorName
    }
}

export class SignInChecks
{
    private static readonly HttpScheme = 'http:'
    private static readonly HttpsScheme = 'https:'
    private static readonly StateParam = 'state'
    private static readonly CodeChallengeParam = 'code_challenge'
    private static readonly NoTenantMatch =
        'PLEXUS_E2E_TENANT matches none of the tenants the account dialog lists (by id or display name)'
    private static readonly ExistingSession =
        'the launched profile already holds a session; the scripted sign-in only signs in a fresh e2e profile '
        + 'and never signs out a session it did not create'

    // Whether `url` is the PKCE authorize URL Plexus opens for sign-in: http(s) with state and
    // code_challenge. The intercepted opener also records any other external link opened meanwhile.
    public static IsAuthorizeUrl(url: string): boolean
    {
        const S = SignInChecks
        let parsed: URL
        try
        {
            parsed = new URL(url)
        }
        catch
        {
            return false
        }
        if (parsed.protocol !== S.HttpScheme && parsed.protocol !== S.HttpsScheme) return false
        return parsed.searchParams.has(S.StateParam) && parsed.searchParams.has(S.CodeChallengeParam)
    }

    public static FirstAuthorizeUrl(urls: readonly string[]): string | undefined
    {
        return urls.find((u) => SignInChecks.IsAuthorizeUrl(u))
    }

    // The index of the tenant to choose: the configured one (by id or display name), else the
    // pre-selected first. A configured tenant that matches nothing fails rather than signing in to
    // whichever tenant happens to be first.
    public static PickTenant(tenants: readonly TenantRow[], wanted: string | undefined): number
    {
        if (wanted === undefined) return 0
        const index = tenants.findIndex((t) => t.Id === wanted || t.DisplayName === wanted)
        if (index < 0) throw new SignInCheckError(SignInChecks.NoTenantMatch)
        return index
    }

    // The fault to report when the launched profile is already signed in, else undefined.
    public static ExistingSessionFault(signedIn: boolean): string | undefined
    {
        return signedIn ? SignInChecks.ExistingSession : undefined
    }
}
