import { describe, it, expect } from 'vitest'
import { IncomingChangeGuard, IncomingChangeOutcome } from '../incoming-change-guard.js'

describe('IncomingChangeGuard', () =>
{
    it('does not clobber a dirty buffer and marks it changed on server', () =>
    {
        const guard = new IncomingChangeGuard()
        expect(guard.Decide('a.todl', true)).toBe(IncomingChangeOutcome.SkipAndMarkChangedOnServer)
        expect(guard.IsChangedOnServer('a.todl')).toBe(true)
    })

    it('applies an incoming change to a clean buffer without marking', () =>
    {
        const guard = new IncomingChangeGuard()
        expect(guard.Decide('a.todl', false)).toBe(IncomingChangeOutcome.Apply)
        expect(guard.IsChangedOnServer('a.todl')).toBe(false)
    })

    it('clears the flag when the local save overwrites (last writer wins)', () =>
    {
        const guard = new IncomingChangeGuard()
        guard.Decide('a.todl', true)
        guard.NoteSaved('a.todl')
        expect(guard.IsChangedOnServer('a.todl')).toBe(false)
    })
})
