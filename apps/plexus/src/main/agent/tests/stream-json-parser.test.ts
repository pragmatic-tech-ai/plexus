import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StreamJsonParser } from '../stream-json-parser.js'
import { AgentEventKind, ASK_TOOL_QUALIFIED, type AgentEvent, type SessionStartedEvent } from '../../../shared/agent-api.js'

const assistantToolUse = (id: string, name: string): string =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } })

test('suppresses the ask-user-question tool_use (the card is its surface), keeps other tools', () => {
    const parser = new StreamJsonParser()
    expect(parser.push(assistantToolUse('t1', ASK_TOOL_QUALIFIED))).toEqual([])
    const normal = parser.push(assistantToolUse('t2', 'Read'))
    expect(normal.length).toBe(1)
    expect(normal[0]!.Kind).toBe(AgentEventKind.ToolUse)
})

test('maps a raw error subtype to a readable sentence (no snake_case leaking into markdown)', () => {
    const parser = new StreamJsonParser()
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: null })
    const events = parser.push(line)
    expect(events.length).toBe(1)
    expect(events[0]!.Kind).toBe(AgentEventKind.Error)
    const msg = (events[0] as { Message: string }).Message
    expect(msg).not.toContain('_')
    expect(msg.toLowerCase()).toContain('error during execution')
})

test('prefers the CLI result text over the subtype code when the result is present', () => {
    const parser = new StreamJsonParser()
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Rate limit reached' })
    const events = parser.push(line)
    expect((events[0] as { Message: string }).Message).toBe('Rate limit reached')
})

function parseFixture(name: string): AgentEvent[] {
    const text = readFileSync(join(__dirname, 'fixtures', name), 'utf8')
    const parser = new StreamJsonParser()
    return text.split('\n').flatMap((line) => parser.push(line))
}

test('parses a hello session: SessionStarted first (with id), streamed text, TurnComplete last, no error', () => {
    const events = parseFixture('hello.stream.jsonl')
    expect(events[0].Kind).toBe(AgentEventKind.SessionStarted)
    expect((events[0] as SessionStartedEvent).SessionId).not.toBe('')
    expect(events.some((e) => e.Kind === AgentEventKind.AssistantText)).toBe(true)
    expect(events[events.length - 1].Kind).toBe(AgentEventKind.TurnComplete)
    expect(events.some((e) => e.Kind === AgentEventKind.Error)).toBe(false)
})

test('surfaces tool use and result from a tool-using session', () => {
    const events = parseFixture('tool.stream.jsonl')
    expect(events.some((e) => e.Kind === AgentEventKind.ToolUse)).toBe(true)
    expect(events.some((e) => e.Kind === AgentEventKind.ToolResult)).toBe(true)
})

test('ignores blank and malformed lines without throwing', () => {
    const parser = new StreamJsonParser()
    expect(parser.push('')).toEqual([])
    expect(parser.push('   ')).toEqual([])
    expect(parser.push('{ not json')).toEqual([])
})
