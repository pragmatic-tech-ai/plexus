// Shared agent contract across Plexus's three Electron layers (main / preload /
// renderer), mirroring file-system-api.ts. Commands go renderer→main via
// ipcRenderer.invoke; agent events are PUSHED main→renderer via
// webContents.send on AgentChannel.Event — the first push channel in Plexus
// (all prior IPC is request/response). Enums, not literals (repo rule).

// Type-only (model-patch-api imports MCP_SERVER_KEY from here; a value import back
// would cycle — the erased type import does not).
import type { ProposedModelPatchRequest } from './model-patch-api.js'

export enum AgentChannel
{
    StartSession   = 'agent:start-session',
    SendTurn       = 'agent:send-turn',
    Abort          = 'agent:abort',
    Event          = 'agent:event',
    // renderer→main: the user's answer to a pending AskUserQuestion card.
    AnswerQuestion = 'agent:answer-question',
    // renderer→main: the WorkspaceRefreshService's result for a pending
    // refresh_project tool call (unblocks the tool).
    RefreshProjectResult = 'agent:refresh-project-result',
    // renderer→main: the create_project card's outcome for a pending
    // create_project tool call (unblocks the tool).
    CreateProjectResult = 'agent:create-project-result',
    // renderer→main: the current problems/diagnostics list for a pending
    // get_problems tool call (unblocks the tool).
    GetProblemsResult = 'agent:get-problems-result',
    // renderer→main: the user's verdict for a pending tool-approval card
    // (unblocks the approve_tool permission hook).
    AnswerToolApproval = 'agent:answer-tool-approval',
    // renderer→main query: the persistent approval rules for a project.
    ListApprovalRules = 'agent:list-approval-rules',
    // renderer→main: drop one persistent approval rule for a project.
    RevokeApprovalRule = 'agent:revoke-approval-rule',
    // renderer→main: dispose one session's subprocess.
    CloseSession = 'agent:close-session',
    // renderer→main query: does the active provider support resuming AI context?
    IsResumable = 'agent:is-resumable',
    // renderer→main query: a project's declared .claude/ agents + skills.
    ListAgentsAndSkills = 'agent:list-agents-and-skills',
}

export enum AgentEventKind
{
    SessionStarted = 'session-started',
    AssistantText  = 'assistant-text',
    ToolUse        = 'tool-use',
    ToolResult     = 'tool-result',
    // The agent called the ask_user_question tool: render a choice card and block
    // until the user answers (see PlexusMcpServer + AnswerQuestion).
    Question       = 'question',
    // The agent called refresh_project: the renderer re-scans + re-validates the
    // target project(s) and replies via AgentChannel.RefreshProjectResult.
    RefreshProject = 'refresh-project',
    // The agent called create_project: the renderer shows the New Project form as
    // a card and replies with the outcome via AgentChannel.CreateProjectResult.
    CreateProject  = 'create-project',
    // The agent called get_problems: the renderer reads the current diagnostics
    // and replies with the list via AgentChannel.GetProblemsResult.
    GetProblems    = 'get-problems',
    // The CLI's permission hook (approve_tool) needs a verdict for a consequential
    // tool (e.g. Bash): render an approval card and block until the user answers
    // or the countdown auto-approves (see PlexusMcpServer + AnswerToolApproval).
    ToolApproval   = 'tool-approval',
    // The agent called propose_model_patch: the renderer shows a patch-preview card
    // and, on Accept, applies the structured ops to the architecture model, replying
    // via ModelPatchChannel.Resolve (see PlexusMcpServer + model-patch-api).
    ProposedModelPatch = 'proposed-model-patch',
    TurnComplete   = 'turn-complete',
    Error          = 'error',
    // A --resume targeted a conversation the CLI no longer has ("No conversation
    // found with session ID …"). The renderer shows a recovery card so the user
    // can start fresh (clear history) or replay the stored transcript as context.
    SessionLost    = 'session-lost',
}

// One selectable choice within a Question. `description` is optional helper text.
export interface QuestionOption { label: string; description?: string }
// One question in a card: prompt + a short header chip + its options. multiSelect
// allows more than one option; the card also offers a free-text "Other".
export interface Question { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }
// The tool payload: 1–4 questions the user answers together, correlated by `id`.
export interface QuestionRequest { id: string; questions: Question[] }
// The user's reply, keyed by question text (mirrors the AskUserQuestion tool); an
// "Other" pick contributes the typed string as one of the array entries.
export interface QuestionAnswer { id: string; answers: Record<string, string[]> }

// refresh_project payloads. `path` (optional) targets one project by containment;
// omitted ⇒ all open projects. Correlated by `id` like a Question.
export interface RefreshProjectRequest { id: string; path?: string }
// Per-project outcome the tool returns to the agent.
export interface RefreshedProjectSummary
{
    name: string
    folder: string
    errorCount: number
    warningCount: number
    sampleMessages: string[]
}
// The tool result: one summary per refreshed project. `note` explains an empty
// set (e.g. path matched nothing); `error` marks a failure to refresh at all.
export interface RefreshProjectResult
{
    id: string
    projects: RefreshedProjectSummary[]
    note?: string
    error?: string
}

// The Plexus MCP tool identities. `MCP_SERVER_KEY` is the --mcp-config key of the
// single in-process server (see PlexusMcpServer), so the CLI re-exposes both tools
// to the model as ASK_TOOL_QUALIFIED / REFRESH_TOOL_QUALIFIED. Kept in this dep-free
// shared module so the stream parser can suppress a tool's chip and the provider can
// allow-list the tools without importing the SDK-heavy server.
export const MCP_SERVER_KEY = 'plexus'
export const ASK_TOOL_NAME = 'ask_user_question'
export const ASK_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${ASK_TOOL_NAME}`
export const REFRESH_TOOL_NAME = 'refresh_project'
export const REFRESH_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${REFRESH_TOOL_NAME}`
export const CREATE_PROJECT_TOOL_NAME = 'create_project'
export const CREATE_PROJECT_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${CREATE_PROJECT_TOOL_NAME}`
export const GET_PROBLEMS_TOOL_NAME = 'get_problems'
export const GET_PROBLEMS_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${GET_PROBLEMS_TOOL_NAME}`
export const GET_SKILL_CONTEXT_TOOL_NAME = 'get_skill_context'
export const GET_SKILL_CONTEXT_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${GET_SKILL_CONTEXT_TOOL_NAME}`
// The headless CLI's permission hook, passed as --permission-prompt-tool. Unlike
// the tools above it is NOT allow-listed (allow-listed tools skip the prompt), so
// consequential tools route here for a user verdict.
export const APPROVE_TOOL_NAME = 'approve_tool'
export const APPROVE_TOOL_QUALIFIED = `mcp__${MCP_SERVER_KEY}__${APPROVE_TOOL_NAME}`

// A published base a prefill proposes to bind, by id + version (structurally a
// renderer BaseRef; kept plain so shared/ has no renderer dependency).
export interface PrefillBaseRef { id: string; version: string }

// create_project payloads. `prefill` is the agent's optional proposal; the user
// finalizes it in the New Project form. Correlated by `id` like a Question.
// `metaModel`/`libraries` pre-fill the base-binding pickers (a meta-model-requiring
// or library-offering type) so an agent-driven create carries its bindings in.
export interface CreateProjectPrefill
{
    name?:      string
    type?:      string
    location?:  string
    metaModel?: PrefillBaseRef
    libraries?: readonly PrefillBaseRef[]
}
export interface CreateProjectRequest { id: string; prefill?: CreateProjectPrefill }
// The outcome the create_project card returns to the agent.
export interface CreateProjectResult
{
    id: string
    created: boolean
    cancelled?: boolean
    folder?: string
    name?: string
    type?: string
    error?: string
}

// get_problems payloads. Reads the current diagnostics (Problems dock) so the
// agent can inspect validation errors/warnings without a file write + refresh.
// `path` (optional) scopes to the open project CONTAINING that file/folder (same
// containment rule as refresh_project); omitted ⇒ every open project's problems.
// `severity` (optional) is a MINIMUM threshold: Error ⇒ errors only; Warning ⇒
// errors + warnings; Info ⇒ +info; Hint ⇒ everything. Correlated by `id`.
export enum ProblemSeverity { Error = 'error', Warning = 'warning', Info = 'info', Hint = 'hint' }
export interface GetProblemsRequest { id: string; path?: string; severity?: ProblemSeverity }
// One problem in the returned list. `uri` is a project-relative file path, or null
// for a project-level diagnostic (no file); `line`/`column` are 1-based and omitted
// when the diagnostic has no source span. `owner` is the producer (e.g. "todl",
// "libraries").
export interface ProblemItem
{
    project:  string
    folder:   string
    uri:      string | null
    severity: ProblemSeverity
    message:  string
    owner:    string
    line?:    number
    column?:  number
}
// The tool result. Counts + total cover the full FILTERED set; `problems` is that
// set capped (see truncated). `note` explains an empty/edge set; `error` marks a
// failure to read at all.
export interface GetProblemsResult
{
    id:           string
    problems:     ProblemItem[]
    errorCount:   number
    warningCount: number
    total:        number
    truncated:    boolean
    note?:        string
    error?:       string
}

// Tool-approval payloads. The CLI's approve_tool hook asks whether a consequential
// tool may run; the user picks one decision. AllowAlways persists a rule (session +
// per-project); AllowOnce/timeout allow this call only; Deny returns a deny verdict.
export enum ToolApprovalDecision { AllowOnce = 'allow-once', AllowAlways = 'allow-always', Deny = 'deny' }
// A remembered approval. `tool` is the tool name (e.g. "Bash"); `prefix` (Bash only)
// is the leading command family (e.g. "python"), so a rule grants a command family,
// not all shell access. A prefix-less rule matches any use of that tool.
export interface ApprovalRule { tool: string; prefix?: string }
// What the approval card shows: tool + (for Bash) the command and its derived prefix.
export interface ToolApprovalRequest { id: string; toolName: string; command?: string; prefix?: string }
// The user's verdict for a pending approval, correlated by `id`.
export interface ToolApprovalAnswer { id: string; decision: ToolApprovalDecision }

// Emitted once per session from the CLI's system:init line.
export interface SessionStartedEvent { Kind: AgentEventKind.SessionStarted; SessionId: string }
// A token delta appended to the growing assistant bubble.
export interface AssistantTextEvent  { Kind: AgentEventKind.AssistantText;  Text: string }
export interface ToolUseEvent        { Kind: AgentEventKind.ToolUse;    Id: string; Name: string; Input: unknown }
export interface ToolResultEvent     { Kind: AgentEventKind.ToolResult; Id: string; Ok: boolean; Summary: string }
export interface QuestionEvent       { Kind: AgentEventKind.Question; Request: QuestionRequest }
export interface RefreshProjectEvent { Kind: AgentEventKind.RefreshProject; Request: RefreshProjectRequest }
export interface CreateProjectEvent  { Kind: AgentEventKind.CreateProject; Request: CreateProjectRequest }
export interface GetProblemsEvent    { Kind: AgentEventKind.GetProblems; Request: GetProblemsRequest }
export interface ToolApprovalEvent   { Kind: AgentEventKind.ToolApproval; Request: ToolApprovalRequest }
export interface ProposedModelPatchEvent { Kind: AgentEventKind.ProposedModelPatch; Request: ProposedModelPatchRequest }
export interface TurnCompleteEvent   { Kind: AgentEventKind.TurnComplete }
export interface AgentErrorEvent     { Kind: AgentEventKind.Error; Message: string }
export interface SessionLostEvent    { Kind: AgentEventKind.SessionLost }

export type AgentEvent =
    | SessionStartedEvent
    | AssistantTextEvent
    | ToolUseEvent
    | ToolResultEvent
    | QuestionEvent
    | RefreshProjectEvent
    | CreateProjectEvent
    | GetProblemsEvent
    | ToolApprovalEvent
    | ProposedModelPatchEvent
    | TurnCompleteEvent
    | AgentErrorEvent
    | SessionLostEvent

// A pushed agent event tagged with the Plexus conversation it belongs to. NB:
// `SessionId` here is Plexus's own conversation id (see AgentSessionManager); a
// wrapped SessionStartedEvent additionally carries the CLI's id in `Event.SessionId`.
export interface TaggedAgentEvent { SessionId: string; Event: AgentEvent }

// A project's declared .claude/ capabilities, discovered by the provider.
export enum AgentSkillKind { Agent = 'agent', Skill = 'skill' }
export interface CatalogItem { kind: AgentSkillKind; name: string; description: string }
export interface ProjectCatalog { agents: CatalogItem[]; skills: CatalogItem[] }

// The low-level bridge exposed on window.api.agent. camelCase verbs mark the raw
// IPC surface; the renderer's AgentService is the PascalCase wrapper. onEvent
// subscribes to the push channel and returns an unsubscribe function.
export interface IAgentApi
{
    // sessionId addresses one conversation; resumeToken (optional) resumes a stored
    // one's AI context on the first new turn. model (optional, '' = default) is the
    // --model alias — a change re-targets the session (respawn with --resume).
    startSession(sessionId: string, workingDirectory: string, addDirs: readonly string[], resumeToken?: string, model?: string): Promise<void>;
    // Dispose one conversation's subprocess.
    closeSession(sessionId: string): Promise<void>;
    // The renderer supplies the working directory + extra dirs + model each turn; a
    // turn lazily starts (or re-targets) the addressed session (see AgentSession).
    sendTurn(sessionId: string, workingDirectory: string, addDirs: readonly string[], text: string, model?: string): Promise<void>;
    abort(sessionId: string): Promise<void>;
    // Whether the active provider can resume AI context (gates persistence).
    isResumable(): Promise<boolean>;
    // Discover a project's declared .claude/ agents + skills.
    listAgentsAndSkills(projectDir: string): Promise<ProjectCatalog>;
    // Discover skills across project/global/packaged scopes as typed descriptors.
    listSkills(projectDir: string): Promise<import('./skill-api.js').SkillDescriptor[]>;
    // Reply to a pending AskUserQuestion card; unblocks the agent's tool call.
    answerQuestion(answer: QuestionAnswer): Promise<void>;
    // The renderer's summary for a pending refresh_project tool call.
    refreshProjectResult(result: RefreshProjectResult): Promise<void>;
    // The renderer's outcome for a pending create_project tool call.
    createProjectResult(result: CreateProjectResult): Promise<void>;
    // The renderer's problems list for a pending get_problems tool call.
    getProblemsResult(result: GetProblemsResult): Promise<void>;
    // Reply to a pending tool-approval card; unblocks the approve_tool hook.
    answerToolApproval(answer: ToolApprovalAnswer): Promise<void>;
    // Read the persistent approval rules for a project (settings surface).
    listApprovalRules(projectKey: string): Promise<ApprovalRule[]>;
    // Drop one persistent approval rule for a project.
    revokeApprovalRule(projectKey: string, rule: ApprovalRule): Promise<void>;
    onEvent(handler: (msg: TaggedAgentEvent) => void): () => void;
}
