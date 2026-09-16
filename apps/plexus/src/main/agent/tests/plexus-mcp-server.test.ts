import { describe, test, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { PlexusMcpServer } from '../plexus-mcp-server.js'
import {
    AgentEventKind, ASK_TOOL_NAME, REFRESH_TOOL_NAME, CREATE_PROJECT_TOOL_NAME, GET_PROBLEMS_TOOL_NAME,
    ProblemSeverity, ToolApprovalDecision,
    type AgentEvent, type QuestionRequest, type RefreshProjectResult, type CreateProjectResult,
    type GetProblemsResult, type TaggedAgentEvent,
} from '../../../shared/agent-api.js'
import { RuleStore } from '../tool-approval-rules.js'

function memStore(): RuleStore {
    const io = new Map<string, string>()
    return new RuleStore({ read: (p) => io.get(p), write: (p, s) => { io.set(p, s) } }, 'x.json')
}

// Proves the merged server hosts BOTH tools under one listener at the MCP protocol
// level: a real MCP client can initialise over Streamable HTTP, list both tools,
// and call them — each surfacing its event and blocking until resolved. (The live
// `claude` CLI probe is manual; this locks server behaviour without spawning it.)

let server: PlexusMcpServer | undefined
let client: Client | undefined

afterEach(async () => {
    await client?.close()
    await server?.close()
    server = undefined
    client = undefined
})

async function connect(timeoutMs?: number): Promise<{ server: PlexusMcpServer; client: Client }>
{
    server = new PlexusMcpServer(timeoutMs)
    await server.listen()
    client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.Url)))
    return { server, client }
}

const QUESTIONS = [{
    question: 'Which approach?', header: 'Approach', multiSelect: false,
    options: [{ label: 'A', description: 'first' }, { label: 'B' }],
}]

describe('PlexusMcpServer — tool surface', () => {
    test('lists both tools under one server', async () => {
        const { client } = await connect()
        const { tools } = await client.listTools()
        const names = tools.map((t) => t.name)
        expect(names).toContain(ASK_TOOL_NAME)
        expect(names).toContain(REFRESH_TOOL_NAME)
        expect(names).toContain(CREATE_PROJECT_TOOL_NAME)
        expect(names).toContain(GET_PROBLEMS_TOOL_NAME)
        expect(tools.find((t) => t.name === ASK_TOOL_NAME)!.inputSchema.properties).toHaveProperty('questions')
        expect(tools.find((t) => t.name === REFRESH_TOOL_NAME)!.inputSchema.properties).toHaveProperty('path')
        const problems = tools.find((t) => t.name === GET_PROBLEMS_TOOL_NAME)!
        expect(problems.inputSchema.properties).toHaveProperty('path')
        expect(problems.inputSchema.properties).toHaveProperty('severity')
    })
})

describe('PlexusMcpServer — get_problems', () => {
    test('requestProblems emits a GetProblems event and resolves with the posted list', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((t) => events.push(t.Event))

        const pending = server.requestProblems('', '/proj/a/file.todl', ProblemSeverity.Error)
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.GetProblems)
        const req = (evt as { Request: { id: string; path?: string; severity?: ProblemSeverity } }).Request
        expect(req.path).toBe('/proj/a/file.todl')
        expect(req.severity).toBe(ProblemSeverity.Error)

        const result: GetProblemsResult = {
            id: req.id, problems: [{ project: 'A', folder: '/proj/a', uri: 'file.todl', severity: ProblemSeverity.Error, message: 'boom', owner: 'todl', line: 1, column: 1 }],
            errorCount: 1, warningCount: 0, total: 1, truncated: false,
        }
        server.resolveProblems(result)
        expect(await pending).toEqual(result)
    })

    test('requestProblems with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestProblems('')
        expect(result.problems.length).toBe(0)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })

    test('requestProblems times out with an error when the renderer never replies', async () => {
        const server = new PlexusMcpServer(20)
        server.setSink(() => { /* never resolves */ })
        const result = await server.requestProblems('')
        expect((result.error ?? '').toLowerCase()).toContain('timed out')
    })
})

describe('PlexusMcpServer — create_project', () => {
    test('requestCreateProject emits a CreateProject event and resolves with the posted result', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((t) => events.push(t.Event))

        const pending = server.requestCreateProject('', { name: 'Acme', type: 'diagram' })
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.CreateProject)
        const req = (evt as { Request: { id: string; prefill?: { name?: string } } }).Request
        expect(req.prefill?.name).toBe('Acme')

        const result: CreateProjectResult = { id: req.id, created: true, folder: '/p/acme', name: 'Acme', type: 'diagram' }
        server.resolveCreate(result)
        expect(await pending).toEqual(result)
    })

    test('requestCreateProject with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestCreateProject('')
        expect(result.created).toBe(false)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })
})

describe('PlexusMcpServer — ask_user_question', () => {
    test('a tool call emits a Question event and blocks until resolveAnswer answers', async () => {
        const { server, client } = await connect()

        let captured: QuestionRequest | undefined
        server.setSink((t) => {
            const event = t.Event
            if (event.Kind !== AgentEventKind.Question) return
            captured = event.Request
            server.resolveAnswer({ id: event.Request.id, answers: { [event.Request.questions[0]!.question]: ['A'] } })
        })

        const result = await client.callTool({ name: ASK_TOOL_NAME, arguments: { questions: QUESTIONS } })
        expect(captured?.questions[0]!.header).toBe('Approach')
        const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
        expect(JSON.parse(text)).toEqual({ 'Which approach?': ['A'] })
    })

    test('with no sink wired the call still completes (empty answer, no hang)', async () => {
        const { client } = await connect()
        const result = await client.callTool({ name: ASK_TOOL_NAME, arguments: { questions: QUESTIONS } })
        const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
        expect(JSON.parse(text)).toEqual({})
    })
})

describe('PlexusMcpServer — approve_tool', () => {
    test('requestApproval on a list MISS emits a ToolApproval event and blocks until answered', async () => {
        const events: AgentEvent[] = []
        const server = new PlexusMcpServer()
        server.setSink((t) => events.push(t.Event))
        server.setRuleStore(memStore(), '/proj')
        const p = server.requestApproval('', 'Bash', { command: 'python foo.py' })
        const evt = events.find((e) => e.Kind === AgentEventKind.ToolApproval)
        expect(evt).toBeDefined()
        const id = (evt as { Request: { id: string; prefix?: string } }).Request.id
        expect((evt as { Request: { prefix?: string } }).Request.prefix).toBe('python')
        server.resolveApproval({ id, decision: ToolApprovalDecision.AllowOnce })
        expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'python foo.py' } })
    })

    test('a persisted-rule HIT allows immediately without emitting an event', async () => {
        const events: AgentEvent[] = []
        const store = memStore()
        store.add('/proj', { tool: 'Bash', prefix: 'python' })
        const server = new PlexusMcpServer()
        server.setSink((t) => events.push(t.Event))
        server.setRuleStore(store, '/proj')
        const result = await server.requestApproval('', 'Bash', { command: 'python bar.py' })
        expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'python bar.py' } })
        expect(events.some((e) => e.Kind === AgentEventKind.ToolApproval)).toBe(false)
    })

    test('allow-always persists a rule; a later matching call is auto-allowed', async () => {
        const store = memStore()
        const server = new PlexusMcpServer()
        server.setSink(() => {})
        server.setRuleStore(store, '/proj')
        const p = server.requestApproval('', 'Bash', { command: 'python a.py' })
        server.resolveApproval({ id: server.LastApprovalId, decision: ToolApprovalDecision.AllowAlways })
        await p
        expect(store.list('/proj')).toEqual([{ tool: 'Bash', prefix: 'python' }])
    })

    test('deny returns a deny verdict', async () => {
        const server = new PlexusMcpServer()
        server.setSink(() => {})
        server.setRuleStore(memStore(), '/proj')
        const p = server.requestApproval('', 'Bash', { command: 'rm -rf /' })
        server.resolveApproval({ id: server.LastApprovalId, decision: ToolApprovalDecision.Deny })
        expect(await p).toEqual({ behavior: 'deny', message: 'Denied by the user in Plexus.' })
    })
})

describe('PlexusMcpServer — refresh_project', () => {
    test('requestRefresh emits a RefreshProject event and resolves with the posted result', async () => {
        const server = new PlexusMcpServer()
        const events: AgentEvent[] = []
        server.setSink((t) => events.push(t.Event))

        const pending = server.requestRefresh('', '/proj/a/file.todl')
        expect(events.length).toBe(1)
        const evt = events[0]!
        expect(evt.Kind).toBe(AgentEventKind.RefreshProject)
        const req = (evt as { Request: { id: string; path?: string } }).Request
        expect(req.path).toBe('/proj/a/file.todl')

        const result: RefreshProjectResult = {
            id: req.id,
            projects: [{ name: 'A', folder: '/proj/a', errorCount: 1, warningCount: 0, sampleMessages: ['boom'] }],
        }
        server.resolveRefresh(result)
        expect(await pending).toEqual(result)
    })

    test('requestRefresh with no sink resolves immediately with an error', async () => {
        const server = new PlexusMcpServer()
        const result = await server.requestRefresh('')
        expect(result.projects.length).toBe(0)
        expect((result.error ?? '').length).toBeGreaterThan(0)
    })

    test('requestRefresh times out with an error when the renderer never replies', async () => {
        const server = new PlexusMcpServer(20) // 20ms timeout
        server.setSink(() => { /* never resolves */ })
        const result = await server.requestRefresh('')
        expect((result.error ?? '').toLowerCase()).toContain('timed out')
    })

    // The refresh tool's HTTP round-trip is structurally identical to
    // ask_user_question's (same handle/transport/buildServer), which the
    // 'tool surface' + ask tests exercise over a real MCP client; here we cover
    // refresh's own logic (event emission, resolve, timeout) as unit tests.

    test('requestRefresh tags its emitted event with the calling session', async () => {
        const server = new PlexusMcpServer()
        const tagged: TaggedAgentEvent[] = []
        server.setSink((t) => tagged.push(t))
        const p = server.requestRefresh('sess-77', '/proj')
        expect(tagged).toHaveLength(1)
        expect(tagged[0]!.SessionId).toBe('sess-77')
        expect(tagged[0]!.Event.Kind).toBe(AgentEventKind.RefreshProject)
        const reqId = (tagged[0]!.Event as { Request: { id: string } }).Request.id
        server.resolveRefresh({ id: reqId, projects: [] })
        await p
    })
})
