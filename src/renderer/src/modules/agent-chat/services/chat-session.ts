// One agent conversation as a dock panel: its transcript, input draft, status,
// approvals — a per-conversation VM (≈ the old AgentService, minus the singleton
// and the window bridge). Provider-free: the send/answer/create actions are
// injected as callbacks by ChatSessionsService, which owns the one IPC stream and
// routes each session's events here.
import {
    Key, MetaData, MuralBase, ObservableCollection, RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'
import type { IDockPanel, IDocument } from '@pragmatic-tech-ai/mural/framework'
import {
    AgentEventKind,
    type AgentEvent, type CreateProjectRequest, type QuestionAnswer, type ToolApprovalAnswer,
} from '../../../../../shared/agent-api.js'
import { TranscriptReducer, UserMessage, AssistantMessage, type MarkdownRender } from './transcript.js'
import type { RecoveryMode } from './session-recovery-card.js'
import type { ApprovalRulesVM } from './approval-rules.js'
import { DEFAULT_MODELS, type ModelOption } from './agent-model.js'
import { ContextItemVM } from './context-item.js'

// The per-conversation actions ChatSession needs, injected by ChatSessionsService
// so the VM stays free of the window bridge + the environment services.
export interface ChatSessionCallbacks
{
    send(sessionId: string, text: string): void
    answerQuestion(sessionId: string, answer: QuestionAnswer): void
    answerToolApproval(sessionId: string, answer: ToolApprovalAnswer): void
    createProject(sessionId: string, req: CreateProjectRequest, reducer: TranscriptReducer): void
    // Persist a title change (and keep the store in sync); close the whole session;
    // focus this conversation's tab from the nav list.
    rename(sessionId: string, title: string): void
    close(sessionId: string): void
    reveal(sessionId: string): void
    // Prompt the user to pick file(s)/folder(s) and add them to this
    // conversation's context (folders / a file's parent dir become --add-dir).
    addContext(sessionId: string): void
    // Interrupt the running turn (terminates the CLI turn; the next message
    // resumes the same conversation).
    stop(sessionId: string): void
}

// A conversation is both an IDockPanel (the primary "Agent Chat" lives in the
// right dock) and an IDocument (every other session opens as an editor tab) — the
// same DataTemplate[ChatSession] renders it in either host.
export class ChatSession extends MuralBase implements IDockPanel, IDocument
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(ChatSession, 'Id', '', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(ChatSession, 'Title', 'Chat', MetaData.None)
    public static readonly TranscriptKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase>>(
        ChatSession, 'Transcript', undefined as unknown as ObservableCollection<MuralBase>, MetaData.None)
    public static readonly DraftKey = MuralBase.RegisterProperty<string>(ChatSession, 'Draft', '', MetaData.None)
    public static readonly StatusKey = MuralBase.RegisterProperty<string>(ChatSession, 'Status', 'idle', MetaData.None)
    // False while the agent is blocked on a pending card — the input row binds
    // IsEnabled = $CanInput so a turn can't be sent mid-question.
    public static readonly CanInputKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'CanInput', true, MetaData.None)
    // True while a turn is in flight; IsIdle is its inverse. The composer shows
    // the stop button when IsBusy and the send button when IsIdle.
    public static readonly IsBusyKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'IsBusy', false, MetaData.None)
    public static readonly IsIdleKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'IsIdle', true, MetaData.None)
    public static readonly SendCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'SendCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly SubmitCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'SubmitCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly StopCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'StopCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ApprovalsKey = MuralBase.RegisterProperty<ApprovalRulesVM>(
        ChatSession, 'Approvals', undefined as unknown as ApprovalRulesVM, MetaData.None)
    // Inline-rename state for the nav-panel row (IsEditing swaps a TextBox in for
    // the title, EditTitle two-ways the draft — same shape as StoredConversationRow).
    public static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'IsEditing', false, MetaData.None)
    public static readonly EditTitleKey = MuralBase.RegisterProperty<string>(ChatSession, 'EditTitle', '', MetaData.None)
    public static readonly BeginRenameCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'BeginRenameCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly RenameKeyCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'RenameKeyCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CloseCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'CloseCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly RevealCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'RevealCommand', undefined as unknown as ICommand, MetaData.None)
    // ── Composer: model picker + added context ──────────────────────────────
    // Models feeds the ComboBox; SelectedModel two-ways the pick (default =
    // Models[0] = Default). ContextItems are the added file/folder chips;
    // HasContext toggles their strip; AddContextCommand opens the picker.
    public static readonly ModelsKey = MuralBase.RegisterProperty<ObservableCollection<ModelOption>>(
        ChatSession, 'Models', undefined as unknown as ObservableCollection<ModelOption>, MetaData.None)
    public static readonly SelectedModelKey = MuralBase.RegisterProperty<ModelOption>(
        ChatSession, 'SelectedModel', undefined as unknown as ModelOption, MetaData.None)
    public static readonly ContextItemsKey = MuralBase.RegisterProperty<ObservableCollection<ContextItemVM>>(
        ChatSession, 'ContextItems', undefined as unknown as ObservableCollection<ContextItemVM>, MetaData.None)
    public static readonly HasContextKey = MuralBase.RegisterProperty<boolean>(ChatSession, 'HasContext', false, MetaData.None)
    public static readonly AddContextCommandKey = MuralBase.RegisterProperty<ICommand>(
        ChatSession, 'AddContextCommand', undefined as unknown as ICommand, MetaData.None)

    private readonly reducer: TranscriptReducer
    private readonly sessionId: string
    private readonly callbacks: ChatSessionCallbacks
    // A one-shot context preamble prepended to the CLI text of the next send only
    // (never echoed) — set by the "replay" recovery path when there is no pending
    // message to resend immediately.
    private pendingPreamble = ''

    constructor(sessionId: string, title: string, callbacks: ChatSessionCallbacks, approvals?: ApprovalRulesVM, render?: MarkdownRender)
    {
        super()
        this.sessionId = sessionId
        this.callbacks = callbacks
        // render drives assistant-bubble markdown → FlowDocument. When omitted the
        // reducer falls back to the lean built-in parser (used by tests); the
        // ChatSessionsService injects the image-capable agent renderer.
        this.reducer = new TranscriptReducer(render)
        this.set_property_value(ChatSession.IdKey, sessionId)
        this.set_property_value(ChatSession.TitleKey, title)
        this.set_property_value(ChatSession.TranscriptKey, this.reducer.Transcript)
        if (approvals !== undefined) this.set_property_value(ChatSession.ApprovalsKey, approvals)

        this.set_property_value(ChatSession.SendCommandKey, new RelayCommand(() => this.send()))
        this.set_property_value(ChatSession.SubmitCommandKey, new RelayCommand((arg) => {
            if ((arg as { Key?: unknown } | undefined)?.Key === Key.Return) this.send()
        }))
        this.set_property_value(ChatSession.CloseCommandKey, new RelayCommand(() => this.callbacks.close(this.sessionId)))
        this.set_property_value(ChatSession.RevealCommandKey, new RelayCommand(() => this.callbacks.reveal(this.sessionId)))
        this.set_property_value(ChatSession.BeginRenameCommandKey, new RelayCommand(() => this.beginRename()))
        this.set_property_value(ChatSession.RenameKeyCommandKey, new RelayCommand((arg) => this.onRenameKey(arg)))

        // Composer: seed the model list (default selected) + an empty context set.
        this.set_property_value(ChatSession.ModelsKey, new ObservableCollection<ModelOption>([...DEFAULT_MODELS]))
        this.set_property_value(ChatSession.SelectedModelKey, DEFAULT_MODELS[0])
        this.set_property_value(ChatSession.ContextItemsKey, new ObservableCollection<ContextItemVM>())
        this.set_property_value(ChatSession.AddContextCommandKey, new RelayCommand(() => this.callbacks.addContext(this.sessionId)))

        this.set_property_value(ChatSession.StopCommandKey, new RelayCommand(() => this.stop()))

        this.reducer.onAnswerSubmitted = (answer) => this.callbacks.answerQuestion(this.sessionId, answer)
        this.reducer.onToolApprovalSubmitted = (answer) => this.callbacks.answerToolApproval(this.sessionId, answer)
        this.reducer.onPendingChange = () =>
            this.set_property_value(ChatSession.CanInputKey, !this.reducer.HasPendingQuestion)
        this.reducer.onBusyChange = () => this.applyBusy()
        this.reducer.onSessionRecovery = (mode) => this.recover(mode)
    }

    // Mirror the reducer's busy flag onto the IsBusy / IsIdle DPs the composer binds.
    private applyBusy(): void
    {
        const busy = this.reducer.IsBusy
        this.set_property_value(ChatSession.IsBusyKey, busy)
        this.set_property_value(ChatSession.IsIdleKey, !busy)
    }

    public get Id(): string { return this.get_property_value(ChatSession.IdKey) }
    public get Title(): string { return this.get_property_value(ChatSession.TitleKey) }
    public get Transcript(): ObservableCollection<MuralBase> { return this.get_property_value(ChatSession.TranscriptKey) }
    public get Draft(): string { return this.get_property_value(ChatSession.DraftKey) }
    public set Draft(value: string) { this.set_property_value(ChatSession.DraftKey, value) }
    public get Status(): string { return this.get_property_value(ChatSession.StatusKey) }
    public get CanInput(): boolean { return this.get_property_value(ChatSession.CanInputKey) }
    public get SendCommand(): ICommand { return this.get_property_value(ChatSession.SendCommandKey) }
    public get SubmitCommand(): ICommand { return this.get_property_value(ChatSession.SubmitCommandKey) }
    public get StopCommand(): ICommand { return this.get_property_value(ChatSession.StopCommandKey) }
    public get IsBusy(): boolean { return this.get_property_value(ChatSession.IsBusyKey) }
    public get IsIdle(): boolean { return this.get_property_value(ChatSession.IsIdleKey) }
    public get Approvals(): ApprovalRulesVM { return this.get_property_value(ChatSession.ApprovalsKey) }
    public get Reducer(): TranscriptReducer { return this.reducer }
    public get IsEditing(): boolean { return this.get_property_value(ChatSession.IsEditingKey) }
    public get EditTitle(): string { return this.get_property_value(ChatSession.EditTitleKey) }
    public set EditTitle(value: string) { this.set_property_value(ChatSession.EditTitleKey, value) }
    public get CloseCommand(): ICommand { return this.get_property_value(ChatSession.CloseCommandKey) }
    public get RevealCommand(): ICommand { return this.get_property_value(ChatSession.RevealCommandKey) }
    public get BeginRenameCommand(): ICommand { return this.get_property_value(ChatSession.BeginRenameCommandKey) }
    public get RenameKeyCommand(): ICommand { return this.get_property_value(ChatSession.RenameKeyCommandKey) }
    public get Models(): ObservableCollection<ModelOption> { return this.get_property_value(ChatSession.ModelsKey) }
    public get SelectedModel(): ModelOption { return this.get_property_value(ChatSession.SelectedModelKey) }
    public set SelectedModel(value: ModelOption) { this.set_property_value(ChatSession.SelectedModelKey, value) }
    public get ContextItems(): ObservableCollection<ContextItemVM> { return this.get_property_value(ChatSession.ContextItemsKey) }
    public get HasContext(): boolean { return this.get_property_value(ChatSession.HasContextKey) }
    public get AddContextCommand(): ICommand { return this.get_property_value(ChatSession.AddContextCommandKey) }

    // The alias sent to the CLI as --model ('' = Default, flag omitted).
    public Model(): string { return this.SelectedModel?.Value ?? '' }

    // Add a picked file/folder to this conversation's context, deduped by the
    // directory that will become --add-dir. Its chip ✕ removes it. Called by
    // ChatSessionsService after the OS picker resolves.
    public addContextItem(path: string, isFolder: boolean): void
    {
        const vm = ContextItemVM.fromPath(path, isFolder, (v) => this.removeContextItem(v))
        if (this.ContextItems.ToArray().some((c) => c.Dir === vm.Dir)) return
        this.ContextItems.Add(vm)
        this.refreshHasContext()
    }

    private removeContextItem(vm: ContextItemVM): void
    {
        this.ContextItems.Remove(vm)
        this.refreshHasContext()
    }

    private refreshHasContext(): void
    {
        this.set_property_value(ChatSession.HasContextKey, this.ContextItems.Count > 0)
    }

    // IDocument surface — conversations auto-persist (ChatSessionsService flushes on
    // turn-complete / close / quit), so the editor tab never shows a dirty dot and
    // Save is a no-op.
    public get IsDirty(): boolean { return false }
    public Save(): void { /* conversations persist themselves; nothing to flush here */ }

    public setStatus(text: string): void { this.set_property_value(ChatSession.StatusKey, text) }

    // Set the tab title directly — used when a Stored row renames a conversation
    // that is currently open, so the live tab reflects the new name.
    public setTitle(title: string): void { this.set_property_value(ChatSession.TitleKey, title) }

    private beginRename(): void
    {
        this.set_property_value(ChatSession.EditTitleKey, this.Title)
        this.set_property_value(ChatSession.IsEditingKey, true)
    }

    // Return commits, Escape cancels — mirrors StoredConversationRow / SubmitCommand.
    private onRenameKey(arg: unknown): void
    {
        const key = (arg as { Key?: unknown } | undefined)?.Key
        if (key === Key.Return) this.commitRename()
        else if (key === Key.Escape) this.set_property_value(ChatSession.IsEditingKey, false)
    }

    private commitRename(): void
    {
        this.set_property_value(ChatSession.IsEditingKey, false)
        const next = this.EditTitle.trim()
        if (next === '' || next === this.Title) return
        this.setTitle(next)
        this.callbacks.rename(this.sessionId, next)
    }

    // Fold one already-routed agent event into this conversation. create_project is
    // delegated (its form needs the environment); everything else goes to the reducer.
    public apply(event: AgentEvent): void
    {
        if (event.Kind === AgentEventKind.CreateProject) { this.callbacks.createProject(this.sessionId, event.Request, this.reducer); return }
        this.reducer.apply(event)
    }

    private send(): void
    {
        const text = this.Draft.trim()
        if (text === '') return
        if (!this.CanInput) return
        if (this.IsBusy) return            // a turn is already running — stop it first
        this.reducer.beginUserTurn(text)   // optimistic echo (also flips IsBusy)
        this.callbacks.send(this.sessionId, this.withPreamble(text))
        this.set_property_value(ChatSession.DraftKey, '')
    }

    // Prepend a pending recovery preamble to what the CLI receives (once), leaving
    // the on-screen message untouched.
    private withPreamble(text: string): string
    {
        if (this.pendingPreamble === '') return text
        const combined = `${this.pendingPreamble}\n\n${text}`
        this.pendingPreamble = ''
        return combined
    }

    // The user picked how to recover a lost session (SessionLost → recovery card).
    // "fresh": wipe the conversation and resend the pending message on a clean
    // session. "replay": keep the transcript and resend (or defer to the next send)
    // with the prior conversation stapled on as context so the fresh CLI session
    // continues aware of it.
    private recover(mode: RecoveryMode): void
    {
        const pending = this.reducer.RecoveryPendingText

        if (mode === 'fresh')
        {
            this.reducer.clear()
            if (pending !== '') { this.reducer.beginUserTurn(pending); this.callbacks.send(this.sessionId, pending) }
            return
        }

        // replay
        const preamble = this.historyPreamble(pending)
        if (pending !== '')
        {
            this.reducer.resumeTurn()
            this.callbacks.send(this.sessionId, preamble !== '' ? `${preamble}\n\n${pending}` : pending)
        }
        else
        {
            // Lost outside a turn (e.g. on reopen): nothing to resend now — carry the
            // preamble into the user's next message.
            this.pendingPreamble = preamble
        }
    }

    // Serialise the visible transcript as a context block for "replay". Skips the
    // trailing pending user message (it's resent on its own) and only includes the
    // user/assistant text turns.
    private historyPreamble(pending: string): string
    {
        const items = this.reducer.Transcript.ToArray()
        const lines: string[] = []
        for (const it of items)
        {
            if (it instanceof UserMessage) lines.push(`User: ${it.Text}`)
            else if (it instanceof AssistantMessage) lines.push(`Assistant: ${it.Text}`)
        }
        // Drop the last line if it's the pending user message we resend separately.
        if (pending !== '' && lines.length > 0 && lines[lines.length - 1] === `User: ${pending}`) lines.pop()
        if (lines.length === 0) return ''
        return `[Earlier conversation, resumed for context — continue from it:]\n\n${lines.join('\n\n')}`
    }

    // Interrupt the running turn. A killed CLI turn emits no TurnComplete, so we
    // force the reducer idle here; the next message resumes the conversation.
    private stop(): void
    {
        if (!this.IsBusy) return
        this.reducer.endTurn()
        this.callbacks.stop(this.sessionId)
    }
}

export default ChatSession
