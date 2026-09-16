import { test, expect, vi } from 'vitest'
import { ToolApprovalCard } from '../approval-card.js'
import { ToolApprovalDecision, type ToolApprovalAnswer } from '../../../../../../shared/agent-api.js'

function card(onSubmit: (a: ToolApprovalAnswer) => void) {
    return new ToolApprovalCard({ id: 'a1', toolName: 'Bash', command: 'python foo.py', prefix: 'python' }, onSubmit, 10000)
}

test('exposes tool, command, and an always-allow label carrying the prefix', () => {
    const c = card(() => {})
    expect(c.ToolName).toBe('Bash')
    expect(c.Command).toBe('python foo.py')
    expect(c.AllowAlwaysLabel).toBe('Always allow python')
    c.dispose()
})

test('a click submits that decision and stops the countdown', () => {
    const seen: ToolApprovalAnswer[] = []
    const c = card((a) => seen.push(a))
    c.DenyCommand.Execute(undefined)
    expect(seen).toEqual([{ id: 'a1', decision: ToolApprovalDecision.Deny }])
    expect(c.IsAnswered).toBe(true)
    c.dispose()
})

test('countdown auto-submits AllowOnce at expiry', () => {
    vi.useFakeTimers()
    const seen: ToolApprovalAnswer[] = []
    const c = card((a) => seen.push(a))
    vi.advanceTimersByTime(10000)
    expect(seen).toEqual([{ id: 'a1', decision: ToolApprovalDecision.AllowOnce }])
    expect(c.Countdown).toBeLessThanOrEqual(0)
    vi.useRealTimers()
    c.dispose()
})
