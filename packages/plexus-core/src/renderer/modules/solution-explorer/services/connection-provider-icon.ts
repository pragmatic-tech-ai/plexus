// The provider-icon identity of a package-store connection, derived from its registry URL.
// One home for the "which provider is this?" rule, shared by the Connections tree (leaf glyph)
// and the inspection dialog (header glyph) so both label a connection the same way. Settings
// carry the registry under the 'registry' key; a connection is GitHub when that URL's host is
// GitHub Packages. Unknown/custom registries return '' and fall back to the generic glyph.
export class ConnectionProviderIcon
{
    public static readonly GitHub = 'github'
    private static readonly GithubHost = 'npm.pkg.github.com'
    private static readonly RegistryKey = 'registry'

    public static For(settings: Readonly<Record<string, unknown>> | undefined): string
    {
        const registry = settings?.[ConnectionProviderIcon.RegistryKey]
        if (typeof registry !== 'string' || registry === '') return ''
        return ConnectionProviderIcon.hostOf(registry) === ConnectionProviderIcon.GithubHost ? ConnectionProviderIcon.GitHub : ''
    }

    private static hostOf(registry: string): string
    {
        try
        {
            return new URL(registry).host
        }
        catch
        {
            return ''
        }
    }
}
