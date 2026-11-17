// The location format of a dev-environment solution:
// dev-environment://<environment name>/<solution name>[/...]. One home for building
// and parsing it, so StorageService can route by scheme without a new parameter.
export class DevEnvironmentLocation
{
    public static readonly BackendId = 'dev-environment'
    public static readonly Scheme = `${DevEnvironmentLocation.BackendId}://`

    private static readonly Separator = '/'

    public static Is(location: string): boolean
    {
        return location.startsWith(DevEnvironmentLocation.Scheme)
    }

    public static Build(environmentName: string, solutionName: string): string
    {
        return DevEnvironmentLocation.Scheme + encodeURIComponent(environmentName)
            + DevEnvironmentLocation.Separator + encodeURIComponent(solutionName)
    }

    // The path inside the environment's source: everything after the environment segment.
    public static RootOf(location: string): string
    {
        const rest = location.slice(DevEnvironmentLocation.Scheme.length)
        const cut = rest.indexOf(DevEnvironmentLocation.Separator)
        return cut < 0 ? '' : rest.slice(cut + 1).split(DevEnvironmentLocation.Separator).map(decodeURIComponent).join(DevEnvironmentLocation.Separator)
    }
}
