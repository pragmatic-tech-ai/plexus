import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { AccountError, AccountErrorKind, TargetSource, UrlBase } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/environment-publish-api.js'
import { RunTestUrl } from '@pragmatic-tech-ai/plexus-core/shared/run-test-api.js'
import type { IRunTestApi, RunTestResult } from '../../shared/run-test-api.js'
import type { IRelaySessionSource } from '../account/relay-connector.js'
import type { RunTestService } from './run-test-service.js'

// Main-process run/test as the renderer sees it: loads the build through RunTestService and adds the
// absolute URL the loaded app is served at. The server serves it same-origin on the host the target's
// source session points at, so the origin (and base path, as the relay keeps it) comes from that session;
// the renderer never learns an address or a token it did not already hold.
export class EnvironmentRunTestApi implements IRunTestApi
{
    public constructor(private readonly service: Pick<RunTestService, 'Run'>, private readonly sessions: Pick<IRelaySessionSource, 'SessionFor'>)
    {
    }

    // Each protocol AppWriteStatus wire value maps to its shared enum member by name; an unmapped value is a failure.
    private static readonly Statuses: Readonly<Record<string, EnvironmentPublishStatus>> =
    {
        applied: EnvironmentPublishStatus.Applied,
        conflict: EnvironmentPublishStatus.Conflict,
        denied: EnvironmentPublishStatus.Denied,
        invalid: EnvironmentPublishStatus.Invalid,
        failed: EnvironmentPublishStatus.Failed,
    }

    private static StatusOf(status: string): EnvironmentPublishStatus
    {
        return EnvironmentRunTestApi.Statuses[status] ?? EnvironmentPublishStatus.Failed
    }

    public async Run(target: TargetRef, outputDir: string): Promise<RunTestResult>
    {
        const session = await this.sessions.SessionFor(target.Source)
        if (session === undefined) throw new AccountError(target.Source === TargetSource.Platform ? AccountErrorKind.PlatformSignedOut : AccountErrorKind.SignedOut)
        const result = await this.service.Run(target, outputDir)
        const address = new URL(session.ConsoleUrl)
        const path = RunTestUrl.PathOf(target.Name, result.appName)
        return {
            Status: EnvironmentRunTestApi.StatusOf(result.status),
            Reason: result.reason,
            AppName: result.appName,
            AppVersion: result.appVersion,
            AppUrl: `${address.origin}${UrlBase.Of(address.pathname)}${path}`,
        }
    }
}
