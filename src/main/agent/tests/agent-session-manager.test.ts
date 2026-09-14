import { test, expect } from 'vitest'
import { AgentSessionManager } from '../agent-session-manager.js'
import { AiProviderService } from '../ai-provider-service.js'
import type { AiProviderSession, IAiProvider } from '../ai-provider.js'
import { AgentEventKind, type AgentEvent, type TaggedAgentEvent } from '../../../shared/agent-api.js'

function recordingProvider() {
    const started: Array<{ sessionId: string; onEvent: (e: AgentEvent) => void; disposed: boolean }> = []
    const provider: IAiProvider = {
        Id: 'rec', Resumable: true,
        listAgentsAndSkills: () => Promise.resolve({ agents: [], skills: [] }),
        listSkills: () => Promise.resolve([]),
        start: (sessionId, _cwd, _dirs, onEvent): AiProviderSession => {
            const rec = { sessionId, onEvent, disposed: false }
            started.push(rec)
            return { send: () => {}, abort: () => {}, dispose: () => { rec.disposed = true; return Promise.resolve() } }
        },
    }
    const svc = new AiProviderService(); svc.register(provider)
    return { svc, started }
}

test('create is idempotent by id', () => {
    const { svc } = recordingProvider()
    const mgr = new AgentSessionManager(svc, () => {})
    const a = mgr.create('s1')
    expect(mgr.create('s1')).toBe(a)
})

test('each session tags its events with its own sessionId', () => {
    const { svc, started } = recordingProvider()
    const tagged: TaggedAgentEvent[] = []
    const mgr = new AgentSessionManager(svc, (t) => tagged.push(t))
    mgr.create('A').start('/p', [])
    mgr.create('B').start('/p', [])
    started[0].onEvent({ Kind: AgentEventKind.TurnComplete })
    started[1].onEvent({ Kind: AgentEventKind.Error, Message: 'x' })
    expect(tagged).toEqual([
        { SessionId: 'A', Event: { Kind: AgentEventKind.TurnComplete } },
        { SessionId: 'B', Event: { Kind: AgentEventKind.Error, Message: 'x' } },
    ])
})

test('close disposes the subprocess and forgets the id', async () => {
    const { svc, started } = recordingProvider()
    const mgr = new AgentSessionManager(svc, () => {})
    mgr.create('s1').start('/p', [])
    await mgr.close('s1')
    expect(started[0].disposed).toBe(true)
    expect(mgr.get('s1')).toBeUndefined()
})

test('disposeAll gracefully tears down every live session and clears the registry', async () => {
    const { svc, started } = recordingProvider()
    const mgr = new AgentSessionManager(svc, () => {})
    mgr.create('A').start('/p', [])
    mgr.create('B').start('/p', [])
    await mgr.disposeAll()
    expect(started.map((s) => s.disposed)).toEqual([true, true])
    expect(mgr.get('A')).toBeUndefined()
    expect(mgr.get('B')).toBeUndefined()
})
