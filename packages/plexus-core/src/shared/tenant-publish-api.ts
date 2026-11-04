// Shared (renderer + main) contract for the "Publish to tenant" feature: the remote build dir, the
// publish status enum and the result shape. Publishing goes through the tenant plane relay, which
// keeps the environment credentials server-side; no credentials ever appear in these types.

// Directory (under the project root) the remote flavor builds into; the renderer builds there and
// the main-process deploy only accepts output dirs containing this segment. Single source of truth.
export const RemoteBuildDirName = 'build-remote'

// Mirrors the protocol AppWriteStatus wire values (a local enum because the renderer cannot
// import the protocol package).
export enum TenantPublishStatus
{
    Applied = 'applied',
    Conflict = 'conflict',
    Denied = 'denied',
    Invalid = 'invalid',
    Failed = 'failed',
}

export interface TenantPublishResult
{
    Status: TenantPublishStatus;
    Reason?: string;
    AppName: string;
    AppVersion: string;
}
