// Renderer-side transcript: three item Models (bound by DataType in
// agent-chat.resources.mu) and the pure reducer that folds AgentEvents into an
// ObservableCollection. Kept free of ServiceBase/window so it is unit-testable;
// AgentService is a thin shell over it.
import { MetaData, MuralBase, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { type FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import { AgentEventKind, type AgentEvent, type QuestionAnswer, type ToolApprovalAnswer } from '../../../../../shared/agent-api.js'
import { buildFlowDocument } from '../../../services/markdown/markdown-document.js'
import { QuestionCard } from './question-card.js'
import { ToolApprovalCard } from './approval-card.js'
import { SessionRecoveryCard, type RecoveryMode } from './session-recovery-card.js'

export enum TranscriptRole { User = 'user', Assistant = 'assistant', Tool = 'tool' }

// Markdown → FlowDocument. Injected so the transcript can render assistant replies
// with images (the agent-chat renderer, resolving `![](…)` against the conversation
// cwd) while non-chat callers (wiki) and tests keep the lean default parser.
export type MarkdownRender = (text: string) => FlowDocument

export class UserMessage extends MuralBase
{
    public static readonly TextKey = MuralBase.RegisterProperty<string>(UserMessage, 'Text', '', MetaData.None)
    constructor(text: string) { super(); this.set_property_value(UserMessage.TextKey, text) }
    public get Text(): string { return this.get_property_value(UserMessage.TextKey) }
}

export class AssistantMessage extends MuralBase
{
    public static readonly TextKey = MuralBase.RegisterProperty<string>(AssistantMessage, 'Text', '', MetaData.None)
    // The formatted view of Text — the agent writes markdown, so we parse it into
    // a FlowDocument the RichTextBlock lays out (headings, bold, code, lists, …).
    // Rebuilt on every delta so formatting appears live as the response streams.
    public static readonly DocumentKey = MuralBase.RegisterProperty<FlowDocument | undefined>(
        AssistantMessage, 'Document', undefined, MetaData.None)

    // How Text becomes the rendered Document. Defaults to the lean built-in parser
    // (no images); the agent chat injects an image-capable renderer.
    private readonly render: MarkdownRender

    constructor(render: MarkdownRender = buildFlowDocument) { super(); this.render = render }

    public get Text(): string { return this.get_property_value(AssistantMessage.TextKey) }
    public get Document(): FlowDocument | undefined { return this.get_property_value(AssistantMessage.DocumentKey) }

    // Append a token delta — set_property_value fires INotifyPropertyChanged so
    // the bound RichTextBlock re-renders live. Reparsing the whole text each time
    // is O(n) per delta; fine for chat-sized responses.
    public appendText(delta: string): void
    {
        const text = this.Text + delta
        this.set_property_value(AssistantMessage.TextKey, text)
        this.set_property_value(AssistantMessage.DocumentKey, this.render(text))
    }
}

// A failed turn, surfaced inline. Unlike AssistantMessage this is PLAIN text
// (rendered by a TextBlock, not a markdown RichTextBlock): error text is often a
// raw code or a stack trace, and markdown would mangle it — e.g.
// `error_during_execution` renders as "error<i>during</i>execution" (underscores
// eaten). Keeping it verbatim also means a stderr tail shows exactly as printed.
export class ErrorMessage extends MuralBase
{
    public static readonly TextKey = MuralBase.RegisterProperty<string>(ErrorMessage, 'Text', '', MetaData.None)
    constructor(text: string) { super(); this.set_property_value(ErrorMessage.TextKey, text) }
    public get Text(): string { return this.get_property_value(ErrorMessage.TextKey) }
}

// A tool the agent invoked. The header (Name + Description + Status) is always
// shown; the body — IN (the tool's command / input) and OUT (a capped slice of
// the result) — collapses. Starts collapsed; ToggleCommand flips it. Every
// view-bound field is a DP (mural binds via get_property_value).
export class ToolActivity extends MuralBase
{
    public static readonly NameKey           = MuralBase.RegisterProperty<string>(ToolActivity, 'Name', '', MetaData.None)
    public static readonly DescriptionKey    = MuralBase.RegisterProperty<string>(ToolActivity, 'Description', '', MetaData.None)
    public static readonly HasDescriptionKey = MuralBase.RegisterProperty<boolean>(ToolActivity, 'HasDescription', false, MetaData.None)
    public static readonly CommandKey        = MuralBase.RegisterProperty<string>(ToolActivity, 'Command', '', MetaData.None)
    public static readonly HasCommandKey     = MuralBase.RegisterProperty<boolean>(ToolActivity, 'HasCommand', false, MetaData.None)
    public static readonly OutputKey         = MuralBase.RegisterProperty<string>(ToolActivity, 'Output', '', MetaData.None)
    public static readonly HasOutputKey      = MuralBase.RegisterProperty<boolean>(ToolActivity, 'HasOutput', false, MetaData.None)
    public static readonly StatusKey         = MuralBase.RegisterProperty<string>(ToolActivity, 'Status', 'running', MetaData.None)
    // IsExpanded + its inverse — no inverse Visibility converter exists, so the
    // collapsed-caret binds $IsCollapsed and the body binds $IsExpanded.
    public static readonly IsExpandedKey     = MuralBase.RegisterProperty<boolean>(ToolActivity, 'IsExpanded', false, MetaData.None)
    public static readonly IsCollapsedKey    = MuralBase.RegisterProperty<boolean>(ToolActivity, 'IsCollapsed', true, MetaData.None)
    public static readonly ToggleCommandKey  = MuralBase.RegisterProperty<ICommand>(
        ToolActivity, 'ToggleCommand', undefined as unknown as ICommand, MetaData.None)

    public readonly Id: string

    constructor(id: string, name: string, input: unknown)
    {
        super()
        this.Id = id
        const description = toolDescription(input)
        const command = toolDetail(input)
        this.set_property_value(ToolActivity.NameKey, name)
        this.set_property_value(ToolActivity.DescriptionKey, description)
        this.set_property_value(ToolActivity.HasDescriptionKey, description !== '')
        this.set_property_value(ToolActivity.CommandKey, command)
        this.set_property_value(ToolActivity.HasCommandKey, command !== '')
        this.set_property_value(ToolActivity.ToggleCommandKey, new RelayCommand(() => this.toggle()))
    }

    public get Name(): string { return this.get_property_value(ToolActivity.NameKey) }
    public get Description(): string { return this.get_property_value(ToolActivity.DescriptionKey) }
    public get HasDescription(): boolean { return this.get_property_value(ToolActivity.HasDescriptionKey) }
    public get Command(): string { return this.get_property_value(ToolActivity.CommandKey) }
    public get HasCommand(): boolean { return this.get_property_value(ToolActivity.HasCommandKey) }
    public get Output(): string { return this.get_property_value(ToolActivity.OutputKey) }
    public get HasOutput(): boolean { return this.get_property_value(ToolActivity.HasOutputKey) }
    public get Status(): string { return this.get_property_value(ToolActivity.StatusKey) }
    public get IsExpanded(): boolean { return this.get_property_value(ToolActivity.IsExpandedKey) }
    public get IsCollapsed(): boolean { return this.get_property_value(ToolActivity.IsCollapsedKey) }
    public get ToggleCommand(): ICommand { return this.get_property_value(ToolActivity.ToggleCommandKey) }

    public setStatus(status: string): void { this.set_property_value(ToolActivity.StatusKey, status) }
    public setOutput(output: string): void
    {
        this.set_property_value(ToolActivity.OutputKey, output)
        this.set_property_value(ToolActivity.HasOutputKey, output !== '')
    }

    private toggle(): void
    {
        const next = !this.IsExpanded
        this.set_property_value(ToolActivity.IsExpandedKey, next)
        this.set_property_value(ToolActivity.IsCollapsedKey, !next)
    }
}

// Header subtitle — the agent's own one-line description (e.g. Bash's
// `description` param). Empty for tools that don't supply one.
function toolDescription(input: unknown): string
{
    if (input !== null && typeof input === 'object')
    {
        const d = (input as Record<string, unknown>).description
        if (typeof d === 'string') return d
    }
    return ''
}

// The IN block — a tool's `command` (Bash) verbatim, otherwise its remaining
// input fields as `key: value` lines. `description` is dropped (header subtitle).
function toolDetail(input: unknown): string
{
    if (input === null || input === undefined) return ''
    if (typeof input !== 'object') return String(input)
    const o = input as Record<string, unknown>
    if (typeof o.command === 'string') return o.command
    return Object.entries(o)
        .filter(([k]) => k !== 'description')
        .map(([k, v]) => `${k}: ${typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)}`)
        .join('\n')
}

export class TranscriptReducer
{
    public readonly Transcript = new ObservableCollection<MuralBase>()

    // Renderer used for every AssistantMessage this reducer opens. Defaults to the
    // lean built-in parser; the agent chat passes an image-capable one.
    private readonly render: MarkdownRender

    constructor(render: MarkdownRender = buildFlowDocument) { this.render = render }

    // The assistant bubble currently being streamed into, or null when the next
    // text delta should open a fresh one.
    private currentAssistant: AssistantMessage | null = null
    // Tool activities awaiting their result, keyed by tool_use id.
    private readonly pendingTools = new Map<string, ToolActivity>()
    // Blocking cards awaiting the user (question + create-project cards), by
    // request id — while any is open the input row is gated.
    private readonly pendingQuestions = new Set<string>()

    // Set by AgentService: forward a submitted answer to the agent bridge, and
    // react when the pending-question set changes (to gate input).
    public onAnswerSubmitted: ((answer: QuestionAnswer) => void) | undefined
    public onPendingChange: (() => void) | undefined
    // Set by AgentService: forward a submitted tool-approval verdict to the bridge.
    public onToolApprovalSubmitted: ((answer: ToolApprovalAnswer) => void) | undefined
    // Fired whenever IsBusy flips — the composer swaps its send/stop button on it.
    public onBusyChange: (() => void) | undefined
    // Set by ChatSession: the user picked how to recover a lost session (see the
    // SessionLost case) — start fresh (clear + resend) or replay history as context.
    public onSessionRecovery: ((mode: RecoveryMode) => void) | undefined

    // The most recent user turn's text — replayed when a session is recovered.
    private lastUserText = ''
    // The user text that was in flight when the session was lost (empty if the loss
    // happened outside a turn, e.g. eagerly on reopen). Read by ChatSession to know
    // whether there's a pending message to resend.
    private recoveryPending = ''
    public get RecoveryPendingText(): string { return this.recoveryPending }

    // True while a turn is in flight: from the user turn until TurnComplete /
    // Error (or an explicit endTurn when the user stops the run).
    private busy = false

    // True while any card is still awaiting an answer (the turn is blocked).
    public get HasPendingQuestion(): boolean { return this.pendingQuestions.size > 0 }

    // True while a turn is running (drives the composer's send↔stop swap).
    public get IsBusy(): boolean { return this.busy }

    private setBusy(value: boolean): void
    {
        if (this.busy === value) return
        this.busy = value
        this.onBusyChange?.()
    }

    // Force the turn to idle — used when the user stops a run (a killed process
    // emits no TurnComplete, so the reducer would otherwise stay busy).
    public endTurn(): void { this.setBusy(false) }

    public beginUserTurn(text: string): void
    {
        this.currentAssistant = null
        this.lastUserText = text
        this.Transcript.Add(new UserMessage(text))
        this.setBusy(true)
    }

    // Resume a turn without echoing a fresh user message — used by the "replay"
    // recovery path, where the pending user message is already on screen and we
    // just re-send it (with a history preamble) to the fresh CLI session.
    public resumeTurn(): void
    {
        this.currentAssistant = null
        this.setBusy(true)
    }

    // Wipe the conversation — used by the "start fresh" recovery path. Leaves the
    // reducer ready for a new turn (persistence catches up on the next flush).
    public clear(): void
    {
        this.Transcript.Clear()
        this.currentAssistant = null
        this.pendingTools.clear()
        this.pendingQuestions.clear()
        this.lastUserText = ''
        this.recoveryPending = ''
        this.setBusy(false)
        this.onPendingChange?.()
    }

    // Add a card built outside the reducer (e.g. the create_project card, whose
    // form AgentService assembles asynchronously), mirroring how the Question case
    // adds a QuestionCard: reset the open assistant bubble, track it as a blocking
    // card so input is gated, and insert it.
    public addPendingCard(id: string, card: MuralBase): void
    {
        this.currentAssistant = null
        this.pendingQuestions.add(id)
        this.Transcript.Add(card)
        this.onPendingChange?.()
    }

    // Release a blocking card once its interaction completes.
    public releasePending(id: string): void
    {
        this.pendingQuestions.delete(id)
        this.onPendingChange?.()
    }

    public apply(event: AgentEvent): void
    {
        switch (event.Kind)
        {
            case AgentEventKind.AssistantText:
                if (this.currentAssistant === null)
                {
                    this.currentAssistant = new AssistantMessage(this.render)
                    this.Transcript.Add(this.currentAssistant)
                }
                this.currentAssistant.appendText(event.Text)
                break

            case AgentEventKind.ToolUse:
            {
                this.currentAssistant = null
                const activity = new ToolActivity(event.Id, event.Name, event.Input)
                this.pendingTools.set(event.Id, activity)
                this.Transcript.Add(activity)
                break
            }

            case AgentEventKind.ToolResult:
            {
                const activity = this.pendingTools.get(event.Id)
                if (activity !== undefined)
                {
                    activity.setStatus(event.Ok ? 'done' : 'failed')
                    activity.setOutput(event.Summary)
                    this.pendingTools.delete(event.Id)
                }
                break
            }

            case AgentEventKind.Question:
            {
                // The agent asked a structured question: render a card and block
                // the turn until the user submits (see PlexusMcpServer).
                this.currentAssistant = null
                const request = event.Request
                this.pendingQuestions.add(request.id)
                const card = new QuestionCard(request, (answer) =>
                {
                    this.pendingQuestions.delete(request.id)
                    this.onAnswerSubmitted?.(answer)
                    this.onPendingChange?.()
                })
                this.Transcript.Add(card)
                this.onPendingChange?.()
                break
            }

            case AgentEventKind.ToolApproval:
            {
                // The CLI's permission hook asked whether a consequential tool may
                // run: render an approval card and block the turn until the user
                // answers or the card's countdown auto-approves once.
                this.currentAssistant = null
                const request = event.Request
                this.pendingQuestions.add(request.id)
                const card = new ToolApprovalCard(request, (answer) =>
                {
                    this.pendingQuestions.delete(request.id)
                    this.onToolApprovalSubmitted?.(answer)
                    this.onPendingChange?.()
                })
                this.Transcript.Add(card)
                this.onPendingChange?.()
                break
            }

            case AgentEventKind.RefreshProject:
                // Handled entirely by WorkspaceRefreshService — not part of the
                // transcript, and it must not disturb the open assistant bubble.
                break

            case AgentEventKind.CreateProject:
                // Handled by AgentService (it builds the form + card asynchronously);
                // not folded here, and it must not disturb the open assistant bubble.
                break

            case AgentEventKind.SessionStarted:
                // No transcript item; keeps the current bubble open.
                this.currentAssistant = null
                break

            case AgentEventKind.TurnComplete:
                // No transcript item; closes the current bubble so the next turn's
                // text starts fresh, and marks the turn idle.
                this.currentAssistant = null
                this.setBusy(false)
                break

            case AgentEventKind.Error:
            {
                // Surface the error inline as a PLAIN-text bubble (not markdown, so
                // codes/stack traces aren't mangled); the turn is over, so drop out
                // of the busy state.
                this.currentAssistant = null
                this.Transcript.Add(new ErrorMessage(`⚠ ${event.Message}`))
                this.setBusy(false)
                break
            }

            case AgentEventKind.SessionLost:
            {
                // The CLI lost this conversation's session. Capture the in-flight user
                // text (if a turn was running) so ChatSession can resend it, drop out
                // of busy, and show a recovery card that gates input until the user
                // chooses to start fresh or replay the stored history.
                this.recoveryPending = this.busy ? this.lastUserText : ''
                this.currentAssistant = null
                this.setBusy(false)
                const card = new SessionRecoveryCard((mode) =>
                {
                    this.pendingQuestions.delete(card.Id)
                    this.onSessionRecovery?.(mode)
                    this.onPendingChange?.()
                })
                this.pendingQuestions.add(card.Id)
                this.Transcript.Add(card)
                this.onPendingChange?.()
                break
            }
        }
    }
}
