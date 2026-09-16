import { test, expect } from 'vitest'
import { MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import { AgentEventKind, type QuestionAnswer } from '../../../../../../shared/agent-api.js'
import { TranscriptReducer, UserMessage, AssistantMessage, ErrorMessage, ToolActivity } from '../transcript.js'
import { SessionRecoveryCard, type RecoveryMode } from '../session-recovery-card.js'
import { QuestionCard } from '../question-card.js'

function items(r: TranscriptReducer) { return Array.from(r.Transcript) }

test('a user turn appends a UserMessage carrying the text', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('hello')
    const list = items(r)
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(UserMessage)
    expect((list[0] as UserMessage).Text).toBe('hello')
})

test('a Question event adds a card, gates input, and submitting answers + clears the gate', () => {
    const r = new TranscriptReducer()
    let pendingChanges = 0
    let answered: QuestionAnswer | undefined
    r.onPendingChange = () => { pendingChanges += 1 }
    r.onAnswerSubmitted = (a) => { answered = a }

    r.apply({ Kind: AgentEventKind.Question, Request: { id: 'q9',
        questions: [{ question: 'Pick?', header: 'Pick', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] } })

    const card = items(r)[0] as QuestionCard
    expect(card).toBeInstanceOf(QuestionCard)
    expect(r.HasPendingQuestion).toBe(true)
    expect(pendingChanges).toBe(1)                 // fired on arrival (gate input)

    const q = card.Questions.ToArray()[0]!
    q.SelectedOption = q.Options.ToArray()[0]!   // single-select picks via the radio group
    card.SubmitCommand.Execute(undefined)

    expect(answered).toEqual({ id: 'q9', answers: { 'Pick?': ['A'] } })
    expect(r.HasPendingQuestion).toBe(false)       // gate released
    expect(pendingChanges).toBe(2)                 // fired again on submit
})

test('assistant text deltas accumulate into ONE growing bubble', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'Hel' })
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'lo' })
    const list = items(r)
    expect(list).toHaveLength(1)
    expect(list[0]).toBeInstanceOf(AssistantMessage)
    expect((list[0] as AssistantMessage).Text).toBe('Hello')
})

test('an injected render drives assistant-bubble documents (image-capable renderer seam)', () => {
    const seen: string[] = []
    const marker = new FlowDocument()
    const render = (text: string): FlowDocument => { seen.push(text); return marker }
    const r = new TranscriptReducer(render)
    r.apply({ Kind: AgentEventKind.AssistantText, Text: '![shot](out/x.png)' })
    const msg = items(r)[0] as AssistantMessage
    // The reducer routed rendering through the injected function, not the default
    // built-in parser — so the agent chat's image-capable renderer is what runs.
    expect(seen).toEqual(['![shot](out/x.png)'])
    expect(msg.Document).toBe(marker)
})

test('a tool use starts a new bubble after assistant text', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'working' })
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    const list = items(r)
    expect(list).toHaveLength(2)
    expect(list[1]).toBeInstanceOf(ToolActivity)
    expect((list[1] as ToolActivity).Name).toBe('Read')
    expect((list[1] as ToolActivity).Status).toBe('running')
})

test('a tool result updates the matching activity status', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: true, Summary: 'ok' })
    const activity = items(r)[0] as ToolActivity
    expect(activity.Status).toBe('done')
})

test('a failed tool result marks the activity failed', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Bash', Input: {} })
    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: false, Summary: 'boom' })
    expect((items(r)[0] as ToolActivity).Status).toBe('failed')
})

test('a Bash tool derives Description + Command and OUT from the result; toggles expand', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Bash',
        Input: { command: 'git status', description: 'Show working tree status' } })
    const a = items(r)[0] as ToolActivity
    expect(a.Description).toBe('Show working tree status')
    expect(a.Command).toBe('git status')
    expect(a.HasCommand).toBe(true)
    expect(a.IsCollapsed).toBe(true)       // starts collapsed
    expect(a.HasOutput).toBe(false)        // no result yet

    r.apply({ Kind: AgentEventKind.ToolResult, Id: 't1', Ok: true, Summary: 'on branch main' })
    expect(a.Output).toBe('on branch main')
    expect(a.HasOutput).toBe(true)

    a.ToggleCommand.Execute(undefined)     // click the header
    expect(a.IsExpanded).toBe(true)
    expect(a.IsCollapsed).toBe(false)
})

test('a non-Bash tool renders its input as key: value IN lines', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: { file_path: '/a/b.ts', limit: 40 } })
    const a = items(r)[0] as ToolActivity
    expect(a.Description).toBe('')                         // no description param
    expect(a.Command).toBe('file_path: /a/b.ts\nlimit: 40')
})

test('assistant text after a tool starts a fresh bubble (does not reopen the old one)', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'a' })
    r.apply({ Kind: AgentEventKind.ToolUse, Id: 't1', Name: 'Read', Input: {} })
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'b' })
    const list = items(r)
    expect(list).toHaveLength(3)
    expect((list[2] as AssistantMessage).Text).toBe('b')
})

test('SessionStarted and TurnComplete add no transcript items', () => {
    const r = new TranscriptReducer()
    r.apply({ Kind: AgentEventKind.SessionStarted, SessionId: 'x' })
    r.apply({ Kind: AgentEventKind.TurnComplete })
    expect(items(r)).toHaveLength(0)
})

test('addPendingCard adds the card, blocks input, and resets the assistant bubble; releasePending clears it', () => {
    const r = new TranscriptReducer()
    let pendingChanges = 0
    r.onPendingChange = () => { pendingChanges += 1 }
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'hi' })   // opens an assistant bubble

    const card = new MuralBase()
    r.addPendingCard('c1', card)
    expect(items(r).includes(card)).toBe(true)
    expect(r.HasPendingQuestion).toBe(true)      // input gated
    expect(pendingChanges).toBe(1)

    // A following AssistantText starts a NEW bubble (the card reset currentAssistant).
    r.apply({ Kind: AgentEventKind.AssistantText, Text: 'more' })
    const texts = items(r).filter((m) => m instanceof AssistantMessage) as AssistantMessage[]
    expect(texts.length).toBe(2)

    r.releasePending('c1')
    expect(r.HasPendingQuestion).toBe(false)
    expect(pendingChanges).toBe(2)
})

test('a user turn marks the reducer busy; TurnComplete clears it', () => {
    const r = new TranscriptReducer()
    const changes: boolean[] = []
    r.onBusyChange = () => changes.push(r.IsBusy)
    expect(r.IsBusy).toBe(false)
    r.beginUserTurn('go')
    expect(r.IsBusy).toBe(true)
    r.apply({ Kind: AgentEventKind.TurnComplete })
    expect(r.IsBusy).toBe(false)
    expect(changes).toEqual([true, false])
})

test('an Error event clears the busy flag', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('go')
    r.apply({ Kind: AgentEventKind.Error, Message: 'boom' })
    expect(r.IsBusy).toBe(false)
})

test('a SessionLost event adds a recovery card, gates input, drops busy, and captures the in-flight message', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('go')
    r.apply({ Kind: AgentEventKind.SessionLost })
    const list = items(r)
    expect(list[list.length - 1]).toBeInstanceOf(SessionRecoveryCard)
    expect(r.HasPendingQuestion).toBe(true)
    expect(r.IsBusy).toBe(false)
    expect(r.RecoveryPendingText).toBe('go')
})

test('choosing on the recovery card fires onSessionRecovery and releases the input gate', () => {
    const r = new TranscriptReducer()
    const modes: RecoveryMode[] = []
    r.onSessionRecovery = (m) => modes.push(m)
    r.beginUserTurn('go')
    r.apply({ Kind: AgentEventKind.SessionLost })
    const card = items(r).find((m) => m instanceof SessionRecoveryCard) as SessionRecoveryCard
    card.StartFreshCommand.Execute(undefined)
    expect(modes).toEqual(['fresh'])
    expect(r.HasPendingQuestion).toBe(false)
})

test('clear() empties the transcript and resets busy + pending state', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('a')
    r.apply({ Kind: AgentEventKind.SessionLost })
    r.clear()
    expect(items(r)).toHaveLength(0)
    expect(r.HasPendingQuestion).toBe(false)
    expect(r.IsBusy).toBe(false)
})

test('an Error event renders a plain-text ErrorMessage that keeps the text verbatim', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('go')
    // A message with underscores would be mangled by markdown; ErrorMessage is a
    // plain-text bubble (TextBlock, not RichTextBlock), so it stays verbatim.
    r.apply({ Kind: AgentEventKind.Error, Message: 'error_during_execution' })
    const list = items(r)
    const bubble = list[list.length - 1]
    expect(bubble).toBeInstanceOf(ErrorMessage)
    expect((bubble as ErrorMessage).Text).toContain('error_during_execution')
})

test('endTurn clears busy once (used when the user stops a run)', () => {
    const r = new TranscriptReducer()
    r.beginUserTurn('go')
    let fired = 0
    r.onBusyChange = () => { fired += 1 }
    r.endTurn()
    expect(r.IsBusy).toBe(false)
    expect(fired).toBe(1)
    r.endTurn()               // idempotent — already idle, no second fire
    expect(fired).toBe(1)
})
