import { test, expect } from 'vitest'
import { Key } from '@pragmatic-tech-ai/mural/runtime'
import { AgentEventKind, type AgentEvent } from '../../../../../../shared/agent-api.js'
import { ChatSession, type ChatSessionCallbacks } from '../chat-session.js'
import { UserMessage, AssistantMessage } from '../transcript.js'
import { SessionRecoveryCard } from '../session-recovery-card.js'
import { AgentModel } from '../agent-model.js'

function fakeCallbacks()
{
    const calls = {
        sent: [] as Array<{ id: string; text: string }>, created: [] as string[],
        renamed: [] as Array<{ id: string; title: string }>, closed: [] as string[], revealed: [] as string[],
        addContext: [] as string[], stopped: [] as string[],
    }
    const cb: ChatSessionCallbacks = {
        send: (id, text) => calls.sent.push({ id, text }),
        answerQuestion: () => {},
        answerToolApproval: () => {},
        createProject: (id) => calls.created.push(id),
        proposeModelPatch: () => {},
        rename: (id, title) => calls.renamed.push({ id, title }),
        close: (id) => calls.closed.push(id),
        reveal: (id) => calls.revealed.push(id),
        addContext: (id) => calls.addContext.push(id),
        stop: (id) => calls.stopped.push(id),
    }
    return { cb, calls }
}

test('the panel identity is the session id + title', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    expect(s.Id).toBe('sess-1')
    expect(s.Title).toBe('Chat 1')
})

test('send forwards the trimmed draft to the callback and clears it', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.Draft = '  hello  '
    s.SendCommand.Execute(undefined)
    expect(calls.sent).toEqual([{ id: 'sess-1', text: 'hello' }])
    expect(s.Draft).toBe('')
})

test('applying an assistant-text event grows the transcript', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.AssistantText, Text: 'hi' })
    expect(s.Transcript.ToArray()).toHaveLength(1)
})

test('a pending question gates input; send is a no-op while gated', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.Question, Request: { id: 'q1', questions: [{ question: 'x?', header: 'h', multiSelect: false, options: [{ label: 'a' }] }] } })
    expect(s.CanInput).toBe(false)
    s.Draft = 'nope'
    s.SendCommand.Execute(undefined)
    expect(calls.sent).toHaveLength(0)
})

test('recovery "start fresh" wipes the transcript and resends the pending message clean', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.AssistantText, Text: 'old reply' })       // a prior exchange
    s.apply({ Kind: AgentEventKind.TurnComplete })
    s.Draft = 'go'; s.SendCommand.Execute(undefined)                          // the message that loses the session
    s.apply({ Kind: AgentEventKind.SessionLost })
    const card = s.Transcript.ToArray().find((m) => m instanceof SessionRecoveryCard) as SessionRecoveryCard
    card.StartFreshCommand.Execute(undefined)
    const items = s.Transcript.ToArray()
    expect(items.some((m) => m instanceof AssistantMessage)).toBe(false)      // old history gone
    expect(items.some((m) => m instanceof UserMessage && (m as UserMessage).Text === 'go')).toBe(true)
    expect(calls.sent).toEqual([{ id: 'sess-1', text: 'go' }, { id: 'sess-1', text: 'go' }]) // resent, no preamble
})

test('recovery "replay" keeps history and resends the pending message with a context preamble', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.Draft = 'first'; s.SendCommand.Execute(undefined)
    s.apply({ Kind: AgentEventKind.AssistantText, Text: 'reply one' })
    s.apply({ Kind: AgentEventKind.TurnComplete })
    s.Draft = 'go'; s.SendCommand.Execute(undefined)
    s.apply({ Kind: AgentEventKind.SessionLost })
    const card = s.Transcript.ToArray().find((m) => m instanceof SessionRecoveryCard) as SessionRecoveryCard
    card.ReplayCommand.Execute(undefined)
    const last = calls.sent[calls.sent.length - 1]
    expect(last.text).toContain('User: first')
    expect(last.text).toContain('Assistant: reply one')
    expect(last.text.trimEnd().endsWith('go')).toBe(true)                     // pending message at the end
    expect(last.text).not.toContain('User: go')                              // not duplicated inside the preamble
    expect(s.Transcript.ToArray().some((m) => m instanceof UserMessage && (m as UserMessage).Text === 'first')).toBe(true) // history kept
})

test('CloseCommand asks the manager to close this session', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.CloseCommand.Execute(undefined)
    expect(calls.closed).toEqual(['sess-1'])
})

test('RevealCommand focuses this session from the nav list', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.RevealCommand.Execute(undefined)
    expect(calls.revealed).toEqual(['sess-1'])
})

test('Enter commits a renamed title — updates the tab and calls back', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.BeginRenameCommand.Execute(undefined)
    expect(s.IsEditing).toBe(true)
    expect(s.EditTitle).toBe('Chat 1')
    s.EditTitle = 'Renamed'
    s.RenameKeyCommand.Execute({ Key: Key.Return })
    expect(s.IsEditing).toBe(false)
    expect(s.Title).toBe('Renamed')
    expect(calls.renamed).toEqual([{ id: 'sess-1', title: 'Renamed' }])
})

test('Escape cancels a rename — no callback, title unchanged', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.BeginRenameCommand.Execute(undefined)
    s.EditTitle = 'Nope'
    s.RenameKeyCommand.Execute({ Key: Key.Escape })
    expect(s.IsEditing).toBe(false)
    expect(s.Title).toBe('Chat 1')
    expect(calls.renamed).toEqual([])
})

test('setTitle updates the tab title (used when a stored row renames a live chat)', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.setTitle('Externally renamed')
    expect(s.Title).toBe('Externally renamed')
})

test('a create-project event is delegated to the callback with the reducer', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.apply({ Kind: AgentEventKind.CreateProject, Request: { id: 'c1' } } as AgentEvent)
    expect(calls.created).toEqual(['sess-1'])
})

test('the model list is seeded and defaults to Default (empty alias)', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    expect(s.Models.Count).toBeGreaterThan(1)
    expect(s.SelectedModel.Value).toBe(AgentModel.Default)
    expect(s.Model()).toBe('')
})

test('Model() reflects the selected picker option', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    const opus = s.Models.ToArray().find((m) => m.Value === AgentModel.Opus)!
    s.SelectedModel = opus
    expect(s.Model()).toBe('opus')
})

test('adding a file context stores its parent dir and toggles HasContext', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    expect(s.HasContext).toBe(false)
    s.addContextItem('C:/proj/src/main.ts', false)
    expect(s.HasContext).toBe(true)
    expect(s.ContextItems.ToArray().map((c) => c.Dir)).toEqual(['C:/proj/src'])
})

test('a context item is deduped by Dir', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.addContextItem('C:/proj/src/main.ts', false)
    s.addContextItem('C:/proj/src/other.ts', false)   // same parent dir → deduped
    expect(s.ContextItems.Count).toBe(1)
})

test('removing a context item via its chip clears HasContext', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.addContextItem('C:/proj', true)
    const chip = s.ContextItems.ToArray()[0]
    chip.RemoveCommand.Execute(undefined)
    expect(s.ContextItems.Count).toBe(0)
    expect(s.HasContext).toBe(false)
})

test('AddContextCommand delegates to the manager callback', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.AddContextCommand.Execute(undefined)
    expect(calls.addContext).toEqual(['sess-1'])
})

test('IsBusy / IsIdle mirror the turn lifecycle', () => {
    const { cb } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    expect(s.IsBusy).toBe(false)
    expect(s.IsIdle).toBe(true)
    s.Draft = 'go'
    s.SendCommand.Execute(undefined)            // send → busy
    expect(s.IsBusy).toBe(true)
    expect(s.IsIdle).toBe(false)
    s.apply({ Kind: AgentEventKind.TurnComplete })
    expect(s.IsBusy).toBe(false)
    expect(s.IsIdle).toBe(true)
})

test('send is ignored while a turn is already running', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.Draft = 'one'
    s.SendCommand.Execute(undefined)            // busy now
    s.Draft = 'two'
    s.SendCommand.Execute(undefined)            // ignored while busy
    expect(calls.sent).toEqual([{ id: 'sess-1', text: 'one' }])
})

test('StopCommand aborts the run and returns to idle', () => {
    const { cb, calls } = fakeCallbacks()
    const s = new ChatSession('sess-1', 'Chat 1', cb)
    s.Draft = 'go'
    s.SendCommand.Execute(undefined)
    expect(s.IsBusy).toBe(true)
    s.StopCommand.Execute(undefined)
    expect(calls.stopped).toEqual(['sess-1'])
    expect(s.IsBusy).toBe(false)
    expect(s.IsIdle).toBe(true)
})
