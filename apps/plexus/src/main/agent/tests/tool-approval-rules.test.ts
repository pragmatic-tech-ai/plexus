import { test, expect } from 'vitest'
import { derivePrefix, ruleFor, matches, RuleStore } from '../tool-approval-rules.js'
import type { ApprovalRule } from '../../../shared/agent-api.js'

test('derivePrefix takes the leading command token for Bash, lowercased', () => {
    expect(derivePrefix('Bash', { command: 'python foo.py' })).toBe('python')
    expect(derivePrefix('Bash', { command: '  NPM run test ' })).toBe('npm')
    expect(derivePrefix('Bash', { command: 'python3 -m venv .v' })).toBe('python3')
})

test('derivePrefix is undefined for non-Bash tools and empty commands', () => {
    expect(derivePrefix('WebFetch', { url: 'https://x' })).toBeUndefined()
    expect(derivePrefix('Bash', {})).toBeUndefined()
    expect(derivePrefix('Bash', { command: '' })).toBeUndefined()
})

test('ruleFor yields tool+prefix for Bash, tool-only otherwise', () => {
    expect(ruleFor('Bash', { command: 'python foo.py' })).toEqual({ tool: 'Bash', prefix: 'python' })
    expect(ruleFor('WebFetch', { url: 'x' })).toEqual({ tool: 'WebFetch' })
})

test('matches respects tool identity and token-boundary prefix', () => {
    const bashPython: ApprovalRule = { tool: 'Bash', prefix: 'python' }
    expect(matches(bashPython, 'Bash', { command: 'python bar.py' })).toBe(true)
    expect(matches(bashPython, 'Bash', { command: 'pythonic thing' })).toBe(false) // token boundary
    expect(matches(bashPython, 'Bash', { command: 'node x' })).toBe(false)
    expect(matches(bashPython, 'WebFetch', { url: 'x' })).toBe(false)
    const anyWeb: ApprovalRule = { tool: 'WebFetch' }
    expect(matches(anyWeb, 'WebFetch', { url: 'anything' })).toBe(true) // prefix-less matches all
})

test('RuleStore round-trips rules per project and revokes them', () => {
    const io = new Map<string, string>()
    const store = new RuleStore({ read: (p) => io.get(p), write: (p, s) => { io.set(p, s) } }, 'file.json')
    expect(store.list('/proj/a')).toEqual([])
    store.add('/proj/a', { tool: 'Bash', prefix: 'python' })
    store.add('/proj/a', { tool: 'WebFetch' })
    store.add('/proj/b', { tool: 'Bash', prefix: 'npm' })
    expect(store.list('/proj/a')).toEqual([{ tool: 'Bash', prefix: 'python' }, { tool: 'WebFetch' }])
    // reload from the same backing store sees persisted rules
    const store2 = new RuleStore({ read: (p) => io.get(p), write: (p, s) => { io.set(p, s) } }, 'file.json')
    expect(store2.list('/proj/a').length).toBe(2)
    store2.remove('/proj/a', { tool: 'WebFetch' })
    expect(store2.list('/proj/a')).toEqual([{ tool: 'Bash', prefix: 'python' }])
    // adding a duplicate is a no-op
    store2.add('/proj/a', { tool: 'Bash', prefix: 'python' })
    expect(store2.list('/proj/a').length).toBe(1)
})
