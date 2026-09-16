// Registry of live AgentSessions keyed by Plexus's sessionId. Each session is one
// provider subprocess; N entries = N conversations running in parallel. Every
// session's events are wrapped as TaggedAgentEvent so the renderer can route them
// back to the right ChatSession.
import { AgentSession } from './agent-session.js'
import type { AiProviderService } from './ai-provider-service.js'
import type { TaggedAgentEvent } from '../../shared/agent-api.js'

export class AgentSessionManager
{
    private readonly sessions = new Map<string, AgentSession>()

    constructor(
        private readonly providers: AiProviderService,
        private readonly emit: (tagged: TaggedAgentEvent) => void,
    ) {}

    // Return the session for this id, creating it (idempotently) on first use.
    public create(sessionId: string): AgentSession
    {
        let session = this.sessions.get(sessionId)
        if (session === undefined)
        {
            session = new AgentSession(this.providers, sessionId, (event) => this.emit({ SessionId: sessionId, Event: event }))
            this.sessions.set(sessionId, session)
        }
        return session
    }

    public get(sessionId: string): AgentSession | undefined { return this.sessions.get(sessionId) }

    public async close(sessionId: string): Promise<void>
    {
        const session = this.sessions.get(sessionId)
        if (session === undefined) return
        this.sessions.delete(sessionId)
        await session.dispose()
    }

    // Gracefully tear down every live session — each flushes its transcript so the
    // conversation resumes next launch. Awaited on app-quit (bounded upstream), so a
    // slow backend can't hang the process; each session's own force-kill fallback
    // guarantees this settles. Runs all shutdowns concurrently.
    public async disposeAll(): Promise<void>
    {
        const sessions = [...this.sessions.values()]
        this.sessions.clear()
        await Promise.all(sessions.map((s) => s.dispose()))
    }
}
