// The graph server a maker contributes solutions to: the server URL and a bearer token. The
// token is a secret and lives only in the main process; it is never logged or placed in an
// error/result.
export interface GraphProfile
{
    ServerUrl: string;
    Token: string;
}

export interface IGraphProfileSource
{
    // The configured profile, or undefined when none (or an incomplete one) is stored.
    Load(): Promise<GraphProfile | undefined>;
}
