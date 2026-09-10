import { test, expect } from 'vitest'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import { serializeTranscript, rehydrateTranscript } from '../transcript-serializer.js'
import { UserMessage, AssistantMessage, ToolActivity, TranscriptRole } from '../transcript.js'

test('user + assistant + tool items serialize to role-tagged text', () => {
    const assistant = new AssistantMessage(); assistant.appendText('hi there')
    const items = [new UserMessage('hello'), assistant, new ToolActivity('t1', 'Bash', { command: 'ls' })]
    const recs = serializeTranscript(items)
    expect(recs).toEqual([
        { Role: TranscriptRole.User, Text: 'hello' },
        { Role: TranscriptRole.Assistant, Text: 'hi there' },
        { Role: TranscriptRole.Tool, Text: 'Bash' },
    ])
})

test('rehydrate rebuilds display items of the right kinds', () => {
    const items = rehydrateTranscript([
        { Role: TranscriptRole.User, Text: 'hello' },
        { Role: TranscriptRole.Assistant, Text: 'world' },
    ])
    expect(items[0]).toBeInstanceOf(UserMessage)
    expect(items[1]).toBeInstanceOf(AssistantMessage)
    expect((items[1] as AssistantMessage).Text).toBe('world')
})

test('rehydrate threads the injected render into restored assistant messages', () => {
    const seen: string[] = []
    rehydrateTranscript(
        [{ Role: TranscriptRole.Assistant, Text: '![p](a.png)' }],
        (text) => { seen.push(text); return new FlowDocument() },
    )
    // A restored bubble renders through the SAME image-capable renderer, so a stored
    // conversation shows its images on reopen (not just the lean default parser).
    expect(seen).toEqual(['![p](a.png)'])
})
