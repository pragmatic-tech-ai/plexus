// Wraps the console `claude` CLI as an IAiProvider. Spawns ONE long-lived
// `claude -p` in stream-json in/out mode (multi-turn over stdin) at the project
// cwd. NON-bare so it rides the user's logged-in subscription (Global
// Constraints). stdout is line-buffered through StreamJsonParser; each user turn
// is written to stdin as a stream-json user message.
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StreamJsonParser } from './stream-json-parser.js'
import { scanClaudeCatalog, type CatalogIo } from './claude-catalog.js'
import { AgentEventKind, type AgentEvent, type ProjectCatalog } from '../../shared/agent-api.js'
import type { AiProviderSession, ChildLike, IAiProvider, McpHttpServerConfig, McpOptions, McpServerConfig, McpStdioServerConfig, SpawnFn } from './ai-provider.js'

// Default catalog IO: a thin node:fs wrapper (the provider scans the real project).
const defaultCatalogIo: CatalogIo = {
    exists: (p) => Promise.resolve(existsSync(p)),
    readDir: (p) => readdir(p),
    readFile: (p) => readFile(p, 'utf8'),
}

// How long a graceful shutdown waits for the CLI to flush + exit on its own before
// the fallback tree-kill fires, so app-quit is never blocked by a hung child.
const SHUTDOWN_GRACE_MS = 3000

const CLI_ARGS = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',                       // required with --print + stream-json
    '--permission-mode', 'acceptEdits', // auto-approve edits; cwd bounds blast radius
]

// shell:true is required on Windows, where `claude` is a `.cmd` shim that Node
// (≥20) refuses to spawn directly. Args are a fixed flag list and the user's
// text goes over stdin (never interpolated into the command line), so there is
// no shell-injection surface.
const defaultSpawn: SpawnFn = (command, args, options) =>
    nodeSpawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: true }) as unknown as ChildLike

export class ClaudeCliProvider implements IAiProvider
{
    public readonly Id = 'claude-cli'
    // The claude CLI can restore an earlier conversation via --resume, so Plexus
    // may persist a conversation and reopen it later. Gates ChatStore persistence.
    public readonly Resumable = true

    constructor(
        private readonly binaryPath: string = 'claude',
        private readonly spawnFn: SpawnFn = defaultSpawn,
        // Resolves the MCP options for a conversation from its working directory
        // (the in-process Plexus tools + the user's registry servers scoped to that
        // project). Called per spawn; when absent, no --mcp-config is passed.
        private readonly mcpResolver: ((cwd: string) => McpOptions) | undefined = undefined,
        // Catalog IO seam (injectable for tests); defaults to node:fs.
        private readonly catalogIo: CatalogIo = defaultCatalogIo,
    ) {}

    // Discover the project's .claude/ agents + skills.
    public listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>
    {
        return scanClaudeCatalog(projectDir, this.catalogIo)
    }

    public start(
        sessionId: string,
        workingDirectory: string,
        addDirs: readonly string[],
        onEvent: (event: AgentEvent) => void,
        resumeToken?: string,
        model?: string,
    ): AiProviderSession
    {
        const resume = resumeToken !== undefined ? ['--resume', resumeToken] : []
        // '' (Default) omits --model so the CLI uses the subscription default.
        const modelArgs = model !== undefined && model !== '' ? ['--model', model] : []
        const args = [...CLI_ARGS, ...resume, ...modelArgs, ...addDirs.flatMap((d) => ['--add-dir', d]), ...this.mcpArgs(sessionId, workingDirectory)]
        const child = this.spawnFn(this.binaryPath, args, { cwd: workingDirectory })
        const parser = new StreamJsonParser()
        let buffer = ''

        // The CLI prints the real failure reason (auth, network, a crashing MCP
        // tool, a stack trace, …) to stderr; the stdout `result` line only carries
        // a generic subtype. Keep a bounded tail of stderr and staple it onto any
        // Error event so the cause is visible instead of a bare, unhelpful code.
        let stderrTail = ''
        const STDERR_TAIL_MAX = 4000
        const forward = (event: AgentEvent): void =>
        {
            if (event.Kind === AgentEventKind.Error && stderrTail.trim() !== '')
                onEvent({ ...event, Message: `${event.Message}\n\n${stderrTail.trim()}` })
            else
                onEvent(event)
        }

        child.stderr.on('data', (chunk) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX)
        })

        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString()
            let newline = buffer.indexOf('\n')
            while (newline !== -1)
            {
                const line = buffer.slice(0, newline)
                buffer = buffer.slice(newline + 1)
                for (const event of parser.push(line)) forward(event)
                newline = buffer.indexOf('\n')
            }
        })

        child.on('error', (err) => {
            forward({ Kind: AgentEventKind.Error, Message: err.message })
        })

        return {
            send: (text) => {
                const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
                child.stdin.write(JSON.stringify(message) + '\n')
            },
            abort:   () => this.terminate(child),
            dispose: () => this.shutdown(child),
        }
    }

    // Graceful shutdown for session-close / app-quit. Ending stdin sends EOF: the
    // CLI reads stream-json turns from stdin until EOF, so this makes it finish any
    // in-flight turn, FLUSH its session transcript to disk (so `--resume` works next
    // launch), and exit — where a bare kill would leave the transcript unfinalized
    // and the conversation unrecoverable. Resolves on the child's 'close'; a bounded
    // fallback tree-kills a child that doesn't exit in time so quit never hangs.
    private shutdown(child: ChildLike): Promise<void>
    {
        return new Promise<void>((resolve) => {
            let settled = false
            const finish = (): void => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
            child.on('close', () => finish())
            const timer = setTimeout(() => { this.terminate(child); finish() }, SHUTDOWN_GRACE_MS)
            try { child.stdin.end() }
            catch { this.terminate(child); finish() }   // stdin already gone → just kill
        })
    }

    // Terminate the spawned turn. On Windows the child is `cmd.exe /c claude.cmd`
    // (shell:true is required for the .cmd shim); a plain kill() would stop the
    // shell but orphan the `node`/`claude` grandchildren, so the agent keeps
    // running. taskkill /T /F tears down the whole tree. Elsewhere, kill() is
    // enough. Falls back to kill() if the pid is unavailable or taskkill throws.
    private terminate(child: ChildLike): void
    {
        const pid = child.pid
        if (process.platform === 'win32' && pid !== undefined)
        {
            try { nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); return }
            catch { /* fall through to kill() */ }
        }
        child.kill()
    }

    // Build the --mcp-config / --allowedTools args. The config is written to a temp
    // FILE (not passed inline): on Windows the provider spawns with shell:true (the
    // `claude.cmd` shim needs it), which mangles an inline-JSON arg. The file is
    // named by the in-process server port + session so concurrent Plexus instances /
    // sessions don't collide. STRICT — only these servers load (no auto-discovery
    // from the user's global Claude config); the MCP Servers panel + Import are the
    // way in. Session-tagging is applied only to the in-process server (tagSession),
    // so external servers get their config verbatim.
    private mcpArgs(sessionId: string, cwd: string): string[]
    {
        const options = this.mcpResolver?.(cwd)
        if (options === undefined) return []
        const servers: Record<string, McpServerConfig> = {}
        let port = '0'
        for (const [key, cfg] of Object.entries(options.servers))
        {
            if ('url' in cfg)
            {
                if (cfg.tagSession === true) { try { port = new URL(cfg.url).port || port } catch { /* keep default */ } }
                const url = cfg.tagSession === true ? `${cfg.url}?session=${encodeURIComponent(sessionId)}` : cfg.url
                const out: McpHttpServerConfig = { type: cfg.type, url }
                if (cfg.headers !== undefined) out.headers = cfg.headers
                servers[key] = out
            }
            else
            {
                const out: McpStdioServerConfig = { command: cfg.command, args: cfg.args }
                if (cfg.env !== undefined) out.env = cfg.env
                servers[key] = out
            }
        }
        const configPath = join(tmpdir(), `plexus-mcp-${port}-${sessionId}.json`)
        writeFileSync(configPath, JSON.stringify({ mcpServers: servers }))
        const allow = options.allowedTools.length > 0 ? ['--allowedTools', ...options.allowedTools] : []
        const disallow = options.disallowedTools !== undefined && options.disallowedTools.length > 0
            ? ['--disallowedTools', ...options.disallowedTools] : []
        const appendPrompt = options.appendSystemPrompt !== undefined && options.appendSystemPrompt.length > 0
            ? ['--append-system-prompt', options.appendSystemPrompt] : []
        const promptTool = options.permissionPromptTool !== undefined
            ? ['--permission-prompt-tool', options.permissionPromptTool] : []
        return ['--mcp-config', configPath, '--strict-mcp-config', ...allow, ...disallow, ...appendPrompt, ...promptTool]
    }
}
