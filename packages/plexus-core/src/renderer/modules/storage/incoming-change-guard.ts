// Collaboration is save-level last-writer-wins: an incoming content change must
// never clobber a buffer with unsaved local edits. The file is flagged "changed on
// server" instead, and the local save overwrites. An incoming change that yields
// content identical to the buffer (a self-originated echo) is a no-op.
export enum IncomingChangeOutcome
{
    Apply = 'apply',
    SkipAndMarkChangedOnServer = 'skip-and-mark-changed-on-server',
}

export class IncomingChangeGuard
{
    private readonly changedOnServer = new Set<string>()

    public Decide(path: string, hasDirtyBuffer: boolean): IncomingChangeOutcome
    {
        if (!hasDirtyBuffer) return IncomingChangeOutcome.Apply
        this.changedOnServer.add(path)
        return IncomingChangeOutcome.SkipAndMarkChangedOnServer
    }

    public IsChangedOnServer(path: string): boolean
    {
        return this.changedOnServer.has(path)
    }

    // The local save overwrites the server copy (last writer wins): clear the flag.
    public NoteSaved(path: string): void
    {
        this.changedOnServer.delete(path)
    }
}
