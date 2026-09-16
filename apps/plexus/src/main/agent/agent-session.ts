// One live conversation, bound to the active provider. Holds the current
// provider session + its target directories; starting a new one disposes the
// old (v1 = a single session). The target is (cwd, addDirs); a send whose target
// differs re-spawns the provider so the agent tracks the open projects. Emits
// every provider event to the sink the IPC layer supplies.
import type { AiProviderSession } from './ai-provider.js'
import type { AiProviderService } from './ai-provider-service.js'
import { AgentEventKind, type AgentEvent } from '../../shared/agent-api.js'

// The CLI's message when --resume targets a conversation it doesn't have. Matched
// on the whole error text (the provider appends the CLI's stderr tail, which is
// where this line lands).
function isResumeFailure(message: string): boolean
{
    return /no conversation found with session id/i.test(message)
}

export class AgentSession
{
    private current: AiProviderSession | null = null
    private target: { cwd: string; addDirs: readonly string[]; model: string } | null = null
    private resumeToken: string | undefined = undefined

    constructor(
        private readonly providers: AiProviderService,
        private readonly sessionId: string,
        private readonly emit: (event: AgentEvent) => void,
    ) {}

    // The captured CLI session id, usable to resume this conversation later
    // (undefined until the first SessionStarted event arrives).
    public get ResumeToken(): string | undefined { return this.resumeToken }

    public start(workingDirectory: string, addDirs: readonly string[], resumeToken?: string, model: string = ''): void
    {
        // Respawn: hard-abort the superseded process (fast + race-free — a graceful
        // stdin-EOF shutdown would leave it flushing while the new `--resume` child
        // spawns against the same session dir). History is preserved via the retained
        // resume token, not this process's flush.
        this.current?.abort()
        if (resumeToken !== undefined) this.resumeToken = resumeToken
        this.current = this.providers.active().start(
            this.sessionId, workingDirectory, addDirs,
            (event) => {
                if (event.Kind === AgentEventKind.SessionStarted) this.resumeToken = event.SessionId
                // A --resume against a conversation the CLI no longer has ("No
                // conversation found with session ID …") — e.g. a reopened session
                // whose headless CLI history is gone. The token is dead: drop it,
                // reset so the next turn spawns fresh, and surface SessionLost (in
                // place of the raw error) so the renderer can ask the user whether to
                // start fresh or replay the stored transcript as context.
                if (event.Kind === AgentEventKind.Error && this.resumeToken !== undefined && isResumeFailure(event.Message))
                {
                    this.resumeToken = undefined
                    this.current = null
                    this.target = null
                    this.emit({ Kind: AgentEventKind.SessionLost })
                    return
                }
                this.emit(event)
            },
            this.resumeToken,
            model,
        )
        this.target = { cwd: workingDirectory, addDirs: [...addDirs], model }
    }

    public send(workingDirectory: string, addDirs: readonly string[], text: string, model: string = ''): void
    {
        if (this.current === null || !this.sameTarget(workingDirectory, addDirs, model)) this.start(workingDirectory, addDirs, undefined, model)
        this.current!.send(text)
    }

    // Interrupt the running turn: terminate the current provider session and drop
    // it (along with its target) so the next send() respawns. The captured
    // resumeToken is retained, so that respawn resumes this conversation via
    // --resume rather than starting a blank one.
    public abort(): void
    {
        this.current?.abort()
        this.current = null
        this.target = null
    }

    // Graceful teardown (session-close / app-quit): let the backend flush its
    // transcript to disk and exit, awaited so the caller can hold quit until the
    // conversation is safely resumable. Retains the resume token for a later reopen.
    public async dispose(): Promise<void>
    {
        const current = this.current
        this.current = null
        this.target = null
        await current?.dispose()
    }

    // True when the running session already targets exactly (cwd, addDirs, model)
    // — same cwd, the same extra directories in order, and the same model. A
    // difference in any dimension respawns (with --resume, preserving history).
    private sameTarget(cwd: string, addDirs: readonly string[], model: string): boolean
    {
        const t = this.target
        return t !== null && t.cwd === cwd && t.model === model
            && t.addDirs.length === addDirs.length
            && t.addDirs.every((d, i) => d === addDirs[i])
    }
}
