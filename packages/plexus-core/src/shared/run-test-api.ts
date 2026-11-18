// Shared (renderer + main) contract for the "Run/Test in environment" feature: the result of loading a
// built remote app into a dev environment's own runtime. The load goes through the relay of the
// target's source; no credential appears in these types.
import type { EnvironmentPublishStatus } from './environment-publish-api.js'

export interface RunTestResult
{
    Status: EnvironmentPublishStatus;
    Reason?: string;
    AppName: string;
    AppVersion: string;
    // The absolute, same-origin URL the loaded app is served at (/app/<environment>/<app>/).
    AppUrl: string;
}

// The one place the served-app path is spelled: the server serves a loaded app at /app/<env>/<app>/.
export class RunTestUrl
{
    private static readonly Prefix = '/app/'
    private static readonly Separator = '/'

    public static PathOf(environment: string, appName: string): string
    {
        return `${RunTestUrl.Prefix}${encodeURIComponent(environment)}${RunTestUrl.Separator}${encodeURIComponent(appName)}${RunTestUrl.Separator}`
    }
}
