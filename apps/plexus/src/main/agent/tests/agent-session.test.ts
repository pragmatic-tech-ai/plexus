import { test, expect } from 'vitest'
import { AgentSession } from '../agent-session.js'
import { AiProviderService } from '../ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from '../ai-provider.js'
import { AgentEventKind, type AgentEvent } from '../../../shared/agent-api.js'

// A provider that records each started session so the test can drive events and
// observe routing.
function recordingProvider() {
    const started: Array<{
        sessionId: string; cwd: string; addDirs: string[]; resumeToken: string | undefined; model: string | undefined
        onEvent: (e: AgentEvent) => void; sent: string[]; disposed: boolean; aborted: boolean
    }> = []
    const provider: IAiProvider = {
        Id: 'rec',
        Resumable: true,
        listAgentsAndSkills: () => Promise.resolve({ agents: [], skills: [] }),
        listSkills: () => Promise.resolve([]),
        start: (sessionId, cwd, addDirs, onEvent, resumeToken, model): AiProviderSession => {
            const rec = { sessionId, cwd, addDirs: [...addDirs], resumeToken, model, onEvent,
                          sent: [] as string[], disposed: false, aborted: false }
            started.push(rec)
            return {
                send: (t) => rec.sent.push(t),
                abort: () => { rec.aborted = true },
                dispose: () => { rec.disposed = true; return Promise.resolve() },
            }
        },
    }
    return { provider, started }
}

function serviceWith(provider: IAiProvider): AiProviderService {
    const svc = new AiProviderService(); svc.register(provider); return svc
}

test('send lazily starts a session at the cwd and forwards the turn', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', [], 'hello')
    expect(started).toHaveLength(1)
    expect(started[0].cwd).toBe('/proj')
    expect(started[0].sent).toEqual(['hello'])
})

test('provider events are relayed to the emit sink', () => {
    const { provider, started } = recordingProvider()
    const emitted: AgentEvent[] = []
    const session = new AgentSession(serviceWith(provider), 'sess-1', (e) => emitted.push(e))
    session.send('/proj', [], 'hi')
    started[0].onEvent({ Kind: AgentEventKind.TurnComplete })
    expect(emitted).toEqual([{ Kind: AgentEventKind.TurnComplete }])
})

test('an explicit start hard-stops the previous session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.start('/a', [])
    session.start('/b', [])
    expect(started[0].aborted).toBe(true)   // superseded process is aborted, not gracefully flushed
    expect(started[1].cwd).toBe('/b')
})

test('abort forwards to the current session', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.start('/a', [])
    session.abort()
    expect(started[0].aborted).toBe(true)
})

test('send reuses the session when the (cwd, addDirs) target is unchanged', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', ['/lib'], 'one')
    session.send('/proj', ['/lib'], 'two')
    expect(started).toHaveLength(1)
    expect(started[0].sent).toEqual(['one', 'two'])
})

test('send restarts the session when the cwd changes', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/a', [], 'one')
    session.send('/b', [], 'two')
    expect(started).toHaveLength(2)
    expect(started[0].aborted).toBe(true)   // superseded process is aborted, not gracefully flushed
    expect(started[1].cwd).toBe('/b')
})

test('send restarts the session when the addDirs set changes', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', ['/lib-a'], 'one')
    session.send('/proj', ['/lib-a', '/lib-b'], 'two')
    expect(started).toHaveLength(2)
    expect(started[1].addDirs).toEqual(['/lib-a', '/lib-b'])
})

test('send restarts the session when the model changes, keeping the resume token', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', [], 'one', '')                                          // default model
    started[0].onEvent({ Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' })
    session.send('/proj', [], 'two', 'opus')                                      // switch model
    expect(started).toHaveLength(2)
    expect(started[0].aborted).toBe(true)                                         // superseded process hard-stopped
    expect(started[1].model).toBe('opus')
    expect(started[1].resumeToken).toBe('cli-1')                                  // resumes the same conversation
})

test('send reuses the session when the model is unchanged', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', [], 'one', 'opus')
    session.send('/proj', [], 'two', 'opus')
    expect(started).toHaveLength(1)
    expect(started[0].sent).toEqual(['one', 'two'])
})

test('abort disposes the running session so the next turn respawns, resuming', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.send('/proj', [], 'one', '')
    started[0].onEvent({ Kind: AgentEventKind.SessionStarted, SessionId: 'cli-1' })
    session.abort()
    expect(started[0].aborted).toBe(true)
    session.send('/proj', [], 'two', '')             // a fresh subprocess, not the dead one
    expect(started).toHaveLength(2)
    expect(started[1].resumeToken).toBe('cli-1')     // resumes the same conversation
})

test('a stale --resume ("No conversation found") surfaces SessionLost, clears the token, and does not auto-restart', () => {
    const { provider, started } = recordingProvider()
    const emitted: AgentEvent[] = []
    const session = new AgentSession(serviceWith(provider), 'sess-1', (e) => emitted.push(e))
    // A reopened conversation resumes a CLI session the CLI no longer has.
    session.start('/proj', [], 'stale-cli-id')
    session.send('/proj', [], 'go')
    expect(started[0].resumeToken).toBe('stale-cli-id')
    started[0].onEvent({ Kind: AgentEventKind.Error,
        Message: 'The agent hit an error during execution.\n\nNo conversation found with session ID: stale-cli-id' })
    // The raw error is replaced by SessionLost (the renderer drives recovery)…
    expect(emitted.some((e) => e.Kind === AgentEventKind.Error)).toBe(false)
    expect(emitted.some((e) => e.Kind === AgentEventKind.SessionLost)).toBe(true)
    // …and no fresh session is auto-spawned.
    expect(started).toHaveLength(1)
})

test('after a lost session the next send spawns fresh, with no resume token', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-1', () => {})
    session.start('/proj', [], 'stale-cli-id')
    session.send('/proj', [], 'go')
    started[0].onEvent({ Kind: AgentEventKind.Error, Message: 'No conversation found with session ID: stale-cli-id' })
    session.send('/proj', [], 'go')                  // the renderer re-drives after the user chooses
    expect(started).toHaveLength(2)
    expect(started[1].resumeToken).toBeUndefined()   // the dead token was dropped
    expect(started[1].sent).toEqual(['go'])
})

test('a normal (non-resume) error is surfaced, not turned into SessionLost', () => {
    const { provider, started } = recordingProvider()
    const emitted: AgentEvent[] = []
    const session = new AgentSession(serviceWith(provider), 'sess-1', (e) => emitted.push(e))
    session.send('/proj', [], 'go')
    started[0].onEvent({ Kind: AgentEventKind.Error, Message: 'The agent hit an error during execution.' })
    expect(started).toHaveLength(1)                                        // no fresh restart
    expect(emitted.some((e) => e.Kind === AgentEventKind.Error)).toBe(true)
})

test('the session id is forwarded to the provider', () => {
    const { provider, started } = recordingProvider()
    new AgentSession(serviceWith(provider), 'sess-9', () => {}).start('/proj', [])
    expect(started[0].sessionId).toBe('sess-9')
})

test('ResumeToken captures the CLI session id from SessionStarted', () => {
    const { provider, started } = recordingProvider()
    const session = new AgentSession(serviceWith(provider), 'sess-9', () => {})
    session.start('/proj', [])
    expect(session.ResumeToken).toBeUndefined()
    started[0].onEvent({ Kind: AgentEventKind.SessionStarted, SessionId: 'cli-777' })
    expect(session.ResumeToken).toBe('cli-777')
})

test('an explicit resume token is forwarded to the provider on start', () => {
    const { provider, started } = recordingProvider()
    new AgentSession(serviceWith(provider), 'sess-9', () => {}).start('/proj', [], 'cli-abc')
    expect(started[0].resumeToken).toBe('cli-abc')
})
