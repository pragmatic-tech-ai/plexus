import { test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeCliProvider } from '../claude-cli-provider.js'
import type { ChildLike, SpawnFn } from '../ai-provider.js'
import { AgentEventKind, AgentSkillKind, type AgentEvent } from '../../../shared/agent-api.js'
import type { CatalogIo } from '../claude-catalog.js'

// A fake child that lets the test drive stdout/error/close and observe stdin/kill.
function fakeChild() {
    const stdoutListeners: Array<(c: string) => void> = []
    const stderrListeners: Array<(c: string) => void> = []
    const errorListeners: Array<(e: Error) => void> = []
    const closeListeners: Array<(code: number | null) => void> = []
    const writes: string[] = []
    let killed = false
    let ended = false
    const child = {
        stdout: { on: (_e: 'data', l: (c: Buffer | string) => void) => stdoutListeners.push(l as (c: string) => void) },
        stderr: { on: (_e: 'data', l: (c: Buffer | string) => void) => stderrListeners.push(l as (c: string) => void) },
        stdin:  { write: (d: string) => writes.push(d), end: () => { ended = true } },
        on: (e: 'error' | 'close', l: (arg: never) => void) => {
            if (e === 'error') errorListeners.push(l as (err: Error) => void)
            else closeListeners.push(l as (code: number | null) => void)
        },
        kill: () => { killed = true },
    } satisfies ChildLike
    return {
        child,
        writes,
        get killed() { return killed },
        get ended() { return ended },
        emitStdout: (s: string) => stdoutListeners.forEach((l) => l(s)),
        emitStderr: (s: string) => stderrListeners.forEach((l) => l(s)),
        emitError:  (e: Error) => errorListeners.forEach((l) => l(e)),
        emitClose:  (code: number | null = 0) => closeListeners.forEach((l) => l(code)),
    }
}

const helloFixture = readFileSync(join(__dirname, 'fixtures', 'hello.stream.jsonl'), 'utf8')
const initLine = helloFixture.split('\n').find((l) => l.includes('"subtype":"init"')) as string

// A spawn that records (command, args, cwd) and returns an inert child.
function captureSpawn() {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = []
    const spawn: SpawnFn = (command, args, options) => {
        calls.push({ command, args: [...args], cwd: options.cwd })
        return {
            stdout: { on: () => {} }, stderr: { on: () => {} },
            stdin: { write: () => {}, end: () => {} }, on: () => {}, kill: () => {},
        } as ChildLike
    }
    return { spawn, calls }
}

test('the provider declares itself resumable', () => {
    expect(new ClaudeCliProvider().Resumable).toBe(true)
})

test('listAgentsAndSkills scans the project .claude via the injected IO', async () => {
    const io: CatalogIo = {
        exists: (p) => Promise.resolve(p === '/p/.claude/agents' || p === '/p/.claude/agents/reviewer.md'),
        readDir: (p) => Promise.resolve(p === '/p/.claude/agents' ? ['reviewer.md'] : []),
        readFile: () => Promise.resolve('---\nname: reviewer\ndescription: d\n---\n'),
    }
    const provider = new ClaudeCliProvider('claude', undefined, undefined, io)
    const catalog = await provider.listAgentsAndSkills('/p')
    expect(catalog.agents).toEqual([{ kind: AgentSkillKind.Agent, name: 'reviewer', description: 'd' }])
    expect(catalog.skills).toEqual([])
})

test('start passes --resume <token> when a resume token is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {}, 'cli-abc')
    const args = calls[0].args
    const i = args.indexOf('--resume')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('cli-abc')
})

test('start omits --resume when no token is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {})
    expect(calls[0].args).not.toContain('--resume')
})

test('start passes --model <alias> when a model is supplied', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {}, undefined, 'opus')
    const args = calls[0].args
    const i = args.indexOf('--model')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('opus')
})

test('start omits --model when the model is empty/unset', () => {
    const { spawn, calls } = captureSpawn()
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {}, undefined, '')
    expect(calls[0].args).not.toContain('--model')
    new ClaudeCliProvider('claude', spawn).start('s2', '/proj', [], () => {})
    expect(calls[1].args).not.toContain('--model')
})

test('the MCP config URL carries the session id so tool calls are attributable', () => {
    const { spawn, calls } = captureSpawn()
    const mcp = { servers: { plexus: { type: 'http' as const, url: 'http://127.0.0.1:9/mcp', tagSession: true } }, allowedTools: [] }
    new ClaudeCliProvider('claude', spawn, () => mcp).start('sess-42', '/proj', [], () => {})
    const args = calls[0].args
    const cfgPath = args[args.indexOf('--mcp-config') + 1]
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'))
    expect(written.mcpServers.plexus.url).toBe('http://127.0.0.1:9/mcp?session=sess-42')
})

test('spawns claude (non-bare) with the streaming flags at the given cwd', () => {
    let captured: { command: string; args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (command, args, options) => { captured = { command, args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', [], () => {})
    expect(captured?.command).toBe('claude')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
    ])
    expect(captured?.args).not.toContain('--bare')
    expect(captured?.options.cwd).toBe('/proj')
})

test('appends --add-dir for each extra directory, spawning at the cwd', () => {
    let captured: { args: string[]; options: { cwd: string } } | undefined
    const spawn: SpawnFn = (_command, args, options) => { captured = { args, options }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn).start('s1', '/proj', ['/lib-a', '/lib-b'], () => {})
    expect(captured?.options.cwd).toBe('/proj')
    expect(captured?.args).toEqual([
        '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
        '--include-partial-messages', '--verbose', '--permission-mode', 'acceptEdits',
        '--add-dir', '/lib-a', '--add-dir', '/lib-b',
    ])
})

test('adds --mcp-config (a temp file) + --allowedTools when MCP options are given', () => {
    let captured: { args: string[] } | undefined
    const spawn: SpawnFn = (_command, args) => { captured = { args }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn, () => ({
        servers: { plexus: { type: 'http', url: 'http://127.0.0.1:12345/mcp', tagSession: true } },
        allowedTools: ['mcp__plexus__ask_user_question'],
        disallowedTools: ['AskUserQuestion'],
    })).start('s1', '/proj', [], () => {})

    const args = captured!.args
    const i = args.indexOf('--mcp-config')
    expect(i).toBeGreaterThan(-1)
    // Config is a FILE path (inline JSON is mangled by the Windows shell), named by
    // port + session (so concurrent sessions don't clobber each other's config).
    expect(args[i + 1]).toContain('plexus-mcp-12345-s1.json')
    expect(args).toContain('--allowedTools')
    expect(args).toContain('mcp__plexus__ask_user_question')
    // The built-in AskUserQuestion is disabled so the model uses our MCP tool.
    expect(args).toContain('--disallowedTools')
    expect(args).toContain('AskUserQuestion')
    // The file really holds our server config, its URL tagged with the session.
    const cfg = JSON.parse(readFileSync(args[i + 1]!, 'utf8'))
    expect(cfg.mcpServers.plexus.url).toBe('http://127.0.0.1:12345/mcp?session=s1')
})

test('writes the server config, allow-lists every tool, and appends the system prompt when given', () => {
    let captured: { args: string[] } | undefined
    const spawn: SpawnFn = (_command, args) => { captured = { args }; return fakeChild().child }
    new ClaudeCliProvider('claude', spawn, () => ({
        servers: {
            plexus: { type: 'http', url: 'http://127.0.0.1:11111/mcp', tagSession: true },
        },
        allowedTools: ['mcp__plexus__ask_user_question', 'mcp__plexus__refresh_project', 'mcp__plexus__create_project'],
        appendSystemPrompt: 'CALL REFRESH ONLY AFTER FILE CHANGES',
    })).start('s1', '/proj', [], () => {})

    const args = captured!.args
    const i = args.indexOf('--mcp-config')
    const cfg = JSON.parse(readFileSync(args[i + 1]!, 'utf8'))
    // One server hosting both tools.
    expect(Object.keys(cfg.mcpServers)).toEqual(['plexus'])
    // Both tools are allow-listed so they run without a permission prompt.
    expect(args).toContain('mcp__plexus__ask_user_question')
    expect(args).toContain('mcp__plexus__refresh_project')
    expect(args).toContain('mcp__plexus__create_project')
    // The instruction rides --append-system-prompt.
    const p = args.indexOf('--append-system-prompt')
    expect(p).toBeGreaterThan(-1)
    expect(args[p + 1]).toBe('CALL REFRESH ONLY AFTER FILE CHANGES')
})

test('forwards parsed events from a real stdout line', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    // The init line carries session_id → SessionStarted.
    f.emitStdout(initLine + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('appends captured stderr to an error event so the real cause is visible', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    // The CLI prints the real reason to stderr; the stdout result only carries a
    // generic subtype. Both arrive; the Error event should carry the reason.
    f.emitStderr('AuthenticationError: invalid x-api-key\n')
    f.emitStdout(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: null }) + '\n')
    const err = events.find((e) => e.Kind === AgentEventKind.Error) as { Message: string } | undefined
    expect(err).toBeTruthy()
    expect(err!.Message).toContain('The agent hit an error during execution.')
    expect(err!.Message).toContain('AuthenticationError: invalid x-api-key')
})

test('a non-error turn does not get stderr noise appended', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    f.emitStderr('warning: some deprecation notice\n')
    f.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }) + '\n')
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(false)
    expect(events.some((e) => e.Kind === AgentEventKind.TurnComplete)).toBe(true)
})

test('buffers a stdout chunk split mid-line until the newline arrives', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    // Split the init line (carries session_id → SessionStarted) mid-way.
    const cut = Math.floor(initLine.length / 2)
    f.emitStdout(initLine.slice(0, cut))
    expect(events).toEqual([])
    f.emitStdout(initLine.slice(cut) + '\n')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
})

test('send writes a stream-json user message to stdin', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], () => {})
    session.send('hi there')
    expect(f.writes).toEqual([
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi there' }] } }) + '\n',
    ])
})

test('abort kills the child', () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], () => {})
    session.abort()
    expect(f.killed).toBe(true)
})

test('dispose gracefully ends stdin (EOF → flush) instead of killing, and resolves when the child exits', async () => {
    const f = fakeChild()
    const session = new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], () => {})
    const done = session.dispose()
    // Graceful: stdin is ended (the CLI flushes + exits on EOF); NOT hard-killed.
    expect(f.ended).toBe(true)
    expect(f.killed).toBe(false)
    // The promise settles once the child reports it has exited.
    f.emitClose(0)
    await done
})

test('dispose falls back to a force-kill if the child does not exit within the grace window', async () => {
    vi.useFakeTimers()
    try {
        const f = fakeChild()
        const session = new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], () => {})
        const done = session.dispose()
        expect(f.ended).toBe(true)
        expect(f.killed).toBe(false)     // still waiting for a clean exit
        await vi.advanceTimersByTimeAsync(3000)
        expect(f.killed).toBe(true)      // grace elapsed → tree-kill fallback
        await done
    } finally {
        vi.useRealTimers()
    }
})

test('emits an Error event when the child errors (e.g. claude not found)', () => {
    const f = fakeChild()
    const events: AgentEvent[] = []
    new ClaudeCliProvider('claude', () => f.child).start('s1', '/proj', [], (e) => events.push(e))
    f.emitError(new Error('spawn claude ENOENT'))
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(true)
})
