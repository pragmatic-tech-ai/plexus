// The tenant a maker publishes to: the server URL and an admin bearer token. The token is a
// secret and lives only in the main process; it is never logged or placed in an error/result.
export interface TenantProfile
{
    ServerUrl: string;
    Token: string;
}

export interface ITenantProfileSource
{
    // The configured profile, or undefined when none (or an incomplete one) is stored.
    Load(): Promise<TenantProfile | undefined>;
}
