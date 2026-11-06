// How a console that the platform no longer registers answers: every /desktop/ call is refused with
// a 503 carrying a fixed error code.
export class ConsoleRetirement
{
    // The error code of the refusal body; the server's ConsoleRegistration.RefusedError
    // (pragmatic-server/admin/control-plane/console-registration.ts).
    public static readonly ErrorCode = 'console-not-registered'
    // The WebSocket close code of a retired console's relay; the server's
    // DesktopRelay.ConsoleRetiredCloseCode (pragmatic-server/admin/control-plane/tenant-auth/desktop-relay.ts).
    public static readonly CloseCode = 4003
    public static readonly Status = 503

    // True only for a JSON object whose error is ErrorCode. Never throws.
    public static IsBody(text: string): boolean
    {
        try
        {
            const parsed: unknown = JSON.parse(text)
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
            return (parsed as Record<string, unknown>).error === ConsoleRetirement.ErrorCode
        }
        catch
        {
            return false
        }
    }
}
