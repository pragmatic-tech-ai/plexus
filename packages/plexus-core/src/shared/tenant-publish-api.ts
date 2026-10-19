// Shared (renderer + main) contract for the "Publish to tenant" feature: the publish status
// enum, the result shape, and the server-URL rule that keeps the admin bearer token off
// cleartext transports. No credentials ever appear in these types.

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

// What the Configure tenant dialog collects. The token is write-only after this point.
export interface TenantProfileInput
{
    ServerUrl: string;
    Token: string;
}

// Validates a tenant server URL. The admin bearer token is sent on connect, so a cleartext
// scheme (ws:/http:) is accepted only for a loopback host; everything else must be wss:/https:.
export class TenantServerUrl
{
    private static readonly Secure: readonly string[] = ['wss:', 'https:']
    private static readonly Cleartext: readonly string[] = ['ws:', 'http:']
    private static readonly LoopbackHosts: readonly string[] = ['localhost', '127.0.0.1', '[::1]']
    private static readonly Malformed = 'The tenant server URL is not a valid URL.'
    private static readonly BadScheme = 'The tenant server URL must use wss:// (or https://).'
    private static readonly Cleartexted = 'The tenant server URL must use wss:// (or https://); plain ws:// is only allowed for localhost, so the admin token is never sent in cleartext.'

    // Returns the trimmed URL when acceptable; throws a descriptive Error otherwise.
    public static Validate(raw: string): string
    {
        const text = raw.trim()
        let url: URL
        try
        {
            url = new URL(text)
        }
        catch
        {
            throw new Error(TenantServerUrl.Malformed)
        }
        if (TenantServerUrl.Secure.includes(url.protocol)) return text
        if (!TenantServerUrl.Cleartext.includes(url.protocol)) throw new Error(TenantServerUrl.BadScheme)
        if (!TenantServerUrl.LoopbackHosts.includes(url.hostname)) throw new Error(TenantServerUrl.Cleartexted)
        return text
    }
}
