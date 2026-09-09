// Main-process agent capability. Owns the AiProviderService (seeded with the
// Claude CLI provider) and a single AgentSession, wired to typed IPC:
//   • commands   renderer→main via ipcMain.handle
//   • events     main→renderer via webContents.send on AgentChannel.Event
// Register once from app.whenReady(), alongside registerFileSystemHandlers().
import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    AgentChannel, APPROVE_TOOL_QUALIFIED, ASK_TOOL_QUALIFIED, CREATE_PROJECT_TOOL_QUALIFIED, GET_PROBLEMS_TOOL_QUALIFIED,
    MCP_SERVER_KEY, REFRESH_TOOL_QUALIFIED,
    type ApprovalRule, type CreateProjectResult, type GetProblemsResult, type ProjectCatalog, type QuestionAnswer,
    type RefreshProjectResult, type TaggedAgentEvent, type ToolApprovalAnswer,
} from '../shared/agent-api.js'
import { AiProviderService } from './agent/ai-provider-service.js'
import { ClaudeCliProvider } from './agent/claude-cli-provider.js'
import { AgentSessionManager } from './agent/agent-session-manager.js'
import { PlexusMcpServer } from './agent/plexus-mcp-server.js'
import { RuleStore } from './agent/tool-approval-rules.js'
import { McpClientRuntime } from './mcp-client/register-mcp-client.js'
import type { BaseMcp } from './mcp-client/mcp-config-resolver.js'

// Appended to the model's system prompt every session so it calls refresh_project
// after — and only after — a turn that changed files or folders in a project.
const REFRESH_INSTRUCTION =
    `Call ${REFRESH_TOOL_QUALIFIED} (optionally with a path you changed) ONLY when the `
    + 'work you just finished created, modified, deleted, moved, or renamed a file or folder inside '
    + 'a project directory, so Plexus re-scans the project from disk and re-validates its models. '
    + 'Call it once at the end of such work, not after every individual edit. Do NOT call it for '
    + 'turns that changed nothing on disk — answering a question, reading or explaining code, '
    + 'running read-only commands, or pure discussion.'

// Push a session-tagged agent event to the renderer (the focused window, falling
// back to the first — a single window today, but this stays correct if more open).
function emitToRenderer(tagged: TaggedAgentEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(AgentChannel.Event, tagged)
}

export async function registerAgentHandlers(): Promise<void>
{
    // Start the single in-process MCP server hosting both agent tools
    // (ask_user_question + refresh_project) and point the CLI at it. Its Question
    // and RefreshProject events ride the same push sink as every other agent event.
    const mcpServer = new PlexusMcpServer()
    await mcpServer.listen()
    mcpServer.setSink(emitToRenderer)

    // Persistent per-project tool-approval rules, stored in Electron userData (never
    // in a project tree). The projectKey is re-pointed to the session's working
    // directory on each start/turn so allow-always is scoped per project.
    const rulesPath = join(app.getPath('userData'), 'agent-approvals.json')
    const store = new RuleStore(
        { read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined), write: (p, s) => writeFileSync(p, s, 'utf8') },
        rulesPath,
    )
    mcpServer.setRuleStore(store, process.cwd())

    // The always-present base: the in-process Plexus server (tagSession so its URL
    // gets ?session= per conversation) + the fixed allow/disallow/prompt options.
    // The MCP-client runtime layers the user's registry servers (global + per-project)
    // on top, resolved per conversation from its working directory.
    const base: BaseMcp = {
        servers: {
            [MCP_SERVER_KEY]: { type: 'http', url: mcpServer.Url, tagSession: true },
        },
        // The four Plexus MCP tools + read-only built-ins auto-approve; everything
        // else (Bash, WebFetch, Write outside edits, …) routes to approve_tool.
        allowedTools: [ASK_TOOL_QUALIFIED, REFRESH_TOOL_QUALIFIED, CREATE_PROJECT_TOOL_QUALIFIED, GET_PROBLEMS_TOOL_QUALIFIED,
                       'Read', 'Glob', 'Grep', 'LS'],
        // Turn off Claude Code's built-in AskUserQuestion (it can't render in
        // headless -p mode → fails), so the model uses our MCP tool instead.
        disallowedTools: ['AskUserQuestion'],
        appendSystemPrompt: REFRESH_INSTRUCTION,
        permissionPromptTool: APPROVE_TOOL_QUALIFIED,
    }
    const mcpRuntime = new McpClientRuntime(base)
    mcpRuntime.register()

    const providers = new AiProviderService()
    providers.register(new ClaudeCliProvider(undefined, undefined, (cwd) => mcpRuntime.resolver.resolve(cwd)))
    const manager = new AgentSessionManager(providers, emitToRenderer)

    // setRuleStore is process-global: approval-rule scope tracks the most recent
    // start/turn's cwd. All conversations share the same workspace dirs today, so
    // this is correct in practice; revisit if per-session cwds ever diverge.
    ipcMain.handle(AgentChannel.StartSession,
        (_e, sessionId: string, workingDirectory: string, addDirs: readonly string[], resumeToken?: string, model?: string): void => {
            mcpServer.setRuleStore(store, workingDirectory)
            manager.create(sessionId).start(workingDirectory, addDirs, resumeToken, model)
        })
    ipcMain.handle(AgentChannel.SendTurn,
        (_e, sessionId: string, workingDirectory: string, addDirs: readonly string[], text: string, model?: string): void => {
            mcpServer.setRuleStore(store, workingDirectory)
            manager.create(sessionId).send(workingDirectory, addDirs, text, model)
        })
    ipcMain.handle(AgentChannel.Abort, (_e, sessionId: string): void => {
        manager.get(sessionId)?.abort()
    })
    ipcMain.handle(AgentChannel.CloseSession, (_e, sessionId: string): Promise<void> =>
        manager.close(sessionId))
    ipcMain.handle(AgentChannel.IsResumable, (): boolean => providers.active().Resumable)
    ipcMain.handle(AgentChannel.ListAgentsAndSkills, (_e, projectDir: string): Promise<ProjectCatalog> =>
        providers.active().listAgentsAndSkills(projectDir))
    // The user's answer to a pending card → unblock the ask_user_question call.
    ipcMain.handle(AgentChannel.AnswerQuestion, (_e, answer: QuestionAnswer): void => {
        mcpServer.resolveAnswer(answer)
    })
    // The renderer's refresh summary → unblock the refresh_project tool call.
    ipcMain.handle(AgentChannel.RefreshProjectResult, (_e, result: RefreshProjectResult): void => {
        mcpServer.resolveRefresh(result)
    })
    // The renderer's create outcome → unblock the create_project tool call.
    ipcMain.handle(AgentChannel.CreateProjectResult, (_e, result: CreateProjectResult): void => {
        mcpServer.resolveCreate(result)
    })
    // The renderer's problems list → unblock the get_problems tool call.
    ipcMain.handle(AgentChannel.GetProblemsResult, (_e, result: GetProblemsResult): void => {
        mcpServer.resolveProblems(result)
    })
    // The user's tool-approval verdict → unblock the approve_tool permission hook.
    ipcMain.handle(AgentChannel.AnswerToolApproval, (_e, answer: ToolApprovalAnswer): void => {
        mcpServer.resolveApproval(answer)
    })
    // Settings surface: read + revoke a project's persistent approval rules.
    ipcMain.handle(AgentChannel.ListApprovalRules, (_e, projectKey: string): ApprovalRule[] => store.list(projectKey))
    ipcMain.handle(AgentChannel.RevokeApprovalRule, (_e, projectKey: string, rule: ApprovalRule): void => {
        store.remove(projectKey, rule)
    })

    // On app-quit, gracefully shut down every live CLI session so each flushes its
    // conversation transcript to disk before the process dies — without this the
    // children are orphaned/hard-killed on quit and `--resume` fails next launch
    // ("No conversation found …"). Defer the quit until they've flushed, bounded so a
    // hung child never blocks it, and re-quit (the guard lets the re-entry through).
    let shuttingDown = false
    app.on('before-quit', (event) => {
        if (shuttingDown) return
        shuttingDown = true
        event.preventDefault()
        const flushed = manager.disposeAll()
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
        void Promise.race([flushed, timeout]).then(() => app.quit(), () => app.quit())
    })
}

// Upper bound on how long app-quit waits for all CLI sessions to flush + exit. Above
// each session's own force-kill fallback, so in the worst case every child is killed
// and this still resolves promptly rather than hanging the quit.
const SHUTDOWN_TIMEOUT_MS = 4000
