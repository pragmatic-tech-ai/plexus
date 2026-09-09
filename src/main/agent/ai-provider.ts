// The provider abstraction — the seam that keeps the auth/billing choice out of
// every consumer. v1 has one implementation (ClaudeCliProvider); an API-key/SDK
// provider slots in later without touching the session, IPC, or renderer.
import type { AgentEvent, ProjectCatalog } from '../../shared/agent-api.js'

// A single live conversation with a backend. Multi-turn: send() writes another
// user turn to the SAME process.
export interface AiProviderSession
{
    send(text: string): void;
    // Interrupt NOW — hard-stop the running turn (user pressed stop, or a respawn
    // supersedes this session). Fire-and-forget; the conversation is resumed later
    // via the retained resume token.
    abort(): void;
    // Graceful teardown for session-close / app-quit: let the backend finish and
    // FLUSH its transcript to disk (so the conversation can be resumed next launch),
    // then exit. Resolves once the child has exited (bounded by a force-kill
    // fallback), so callers can await it before quitting.
    dispose(): Promise<void>;
}

export interface IAiProvider
{
    readonly Id: string;
    // Can this provider restore an earlier conversation's AI context? Gates whether
    // the renderer persists a conversation for later resume.
    readonly Resumable: boolean;
    // sessionId = Plexus's stable id for this conversation (threaded into the MCP
    // config URL so tool calls are attributable). resumeToken = a prior CLI session
    // id to resume, when reopening a stored conversation. model = the --model alias
    // ('' = omit the flag; the backend picks the subscription default).
    start(
        sessionId: string,
        workingDirectory: string,
        addDirs: readonly string[],
        onEvent: (event: AgentEvent) => void,
        resumeToken?: string,
        model?: string,
    ): AiProviderSession;
    // Discover the project's declared .claude/ agents + skills (provider-owned so a
    // different provider can discover differently).
    listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>;
}

// An extra MCP server the provider mounts into the backend. Kept generic so the
// provider stays unaware of what a server does — it just wires servers + allow-listed
// tool names into the CLI. Two transports: HTTP/SSE (the in-process Plexus tools + any
// remote server) and stdio (a local command). Only the in-process server sets
// tagSession, so its URL gets ?session=<id> appended for tool-call attribution;
// external servers do not.
export interface McpHttpServerConfig { type: 'http' | 'sse'; url: string; headers?: Record<string, string>; tagSession?: boolean }
export interface McpStdioServerConfig { command: string; args: string[]; env?: Record<string, string> }
export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig
export interface McpOptions
{
    servers: Record<string, McpServerConfig>;
    // Tool names to auto-approve (e.g. `mcp__plexus__ask_user_question`), so the
    // headless CLI runs them without a permission prompt.
    allowedTools: readonly string[];
    // Tool names to disable. Used to turn OFF Claude Code's built-in
    // `AskUserQuestion` (which can't render in headless -p mode and fails), so the
    // model uses our MCP tool instead.
    disallowedTools?: readonly string[];
    // Text appended to the backend's system prompt each session (via
    // --append-system-prompt). Used to instruct the model to call refresh_project
    // after file-changing turns.
    appendSystemPrompt?: string;
    // The fully-qualified MCP tool the headless CLI calls to approve tool use
    // (`mcp__plexus__approve_tool`). Emitted as --permission-prompt-tool.
    permissionPromptTool?: string;
}

// The subset of a spawned child this provider uses. Kept minimal + injectable so
// ClaudeCliProvider is unit-testable without a real process.
export interface ChildLike
{
    // The OS process id, used to tree-kill the shell + its grandchildren on
    // Windows (undefined before spawn / in fakes → callers fall back to kill()).
    pid?: number;
    stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
    stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): void };
    // end() closes stdin (EOF) — the graceful-shutdown signal: the CLI reads
    // stream-json turns from stdin until EOF, so ending it makes the CLI finish,
    // flush its session transcript, and exit cleanly.
    stdin:  { write(data: string): void; end(): void };
    on(event: 'error', listener: (err: Error) => void): void;
    on(event: 'close', listener: (code: number | null) => void): void;
    kill(): void;
}

export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildLike
