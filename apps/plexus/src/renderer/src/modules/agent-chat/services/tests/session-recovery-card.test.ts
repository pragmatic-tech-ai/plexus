import { test, expect } from 'vitest'
import { SessionRecoveryCard, type RecoveryMode } from '../session-recovery-card.js'

test('Start fresh picks "fresh", collapses to a summary, and fires exactly once', () => {
    const modes: RecoveryMode[] = []
    const card = new SessionRecoveryCard((m) => modes.push(m))
    expect(card.IsPending).toBe(true)
    expect(card.IsDone).toBe(false)

    card.StartFreshCommand.Execute(undefined)
    expect(modes).toEqual(['fresh'])
    expect(card.IsPending).toBe(false)
    expect(card.IsDone).toBe(true)
    expect(card.Choice).not.toBe('')

    // A second click (either button) is ignored.
    card.ReplayCommand.Execute(undefined)
    expect(modes).toEqual(['fresh'])
})

test('Continue picks "replay"', () => {
    const modes: RecoveryMode[] = []
    const card = new SessionRecoveryCard((m) => modes.push(m))
    card.ReplayCommand.Execute(undefined)
    expect(modes).toEqual(['replay'])
    expect(card.IsPending).toBe(false)
})

test('each card has a distinct correlation id', () => {
    const a = new SessionRecoveryCard(() => {})
    const b = new SessionRecoveryCard(() => {})
    expect(a.Id).not.toBe(b.Id)
})
