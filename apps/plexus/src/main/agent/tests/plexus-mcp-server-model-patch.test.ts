import { test, expect } from 'vitest'
import { PlexusMcpServer } from '../plexus-mcp-server.js'
import { AgentEventKind, type TaggedAgentEvent } from '../../../shared/agent-api.js'
import { ModelPatchDecision, PatchOpKind, type ModelPatch, type ProposedModelPatchRequest } from '../../../shared/model-patch-api.js'

type RequestModelPatch = (sessionId: string, projectPath: string, patch: ModelPatch) => Promise<ModelPatchDecision>

function requestOn(server: PlexusMcpServer): RequestModelPatch {
    return (server as unknown as { requestModelPatch: RequestModelPatch }).requestModelPatch.bind(server)
}

const patch: ModelPatch = { summary: 's', ops: [{ kind: PatchOpKind.SetField, id: 'x', field: 'name', value: 'y' }] }

test('emits a ProposedModelPatch event and resolves with the accept decision', async () => {
    const events: TaggedAgentEvent[] = []
    const server = new PlexusMcpServer()
    server.setSink((e) => events.push(e))
    const p = requestOn(server)('sess', '/proj', patch)
    const evt = events.find(e => e.Event.Kind === AgentEventKind.ProposedModelPatch)
    expect(evt).toBeDefined()
    const req = (evt!.Event as { Request: ProposedModelPatchRequest }).Request
    expect(req.projectPath).toBe('/proj')
    server.resolveModelPatch({ id: req.id, decision: ModelPatchDecision.Accept })
    expect(await p).toBe(ModelPatchDecision.Accept)
})

test('auto-rejects when no sink is wired (headless)', async () => {
    const server = new PlexusMcpServer()
    expect(await requestOn(server)('sess', '/proj', patch)).toBe(ModelPatchDecision.Reject)
})

test('resolveModelPatch is a no-op for a stale id', () => {
    const server = new PlexusMcpServer()
    server.resolveModelPatch({ id: 'nope', decision: ModelPatchDecision.Accept }) // must not throw
    expect(true).toBe(true)
})
