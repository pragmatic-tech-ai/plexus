import { describe, test, expect } from 'vitest'
import { ValueSourceResolver } from '../value-source.js'
import { ValueSourceKind } from '../../../shared/mcp-client-api.js'

describe('ValueSourceResolver', () => {
    const r = new ValueSourceResolver({ TOKEN: 'secret', EMPTY: '' } as NodeJS.ProcessEnv)
    test('literal returns its value', () => {
        expect(r.resolve({ kind: ValueSourceKind.Literal, value: 'abc' })).toBe('abc')
    })
    test('env returns the variable value', () => {
        expect(r.resolve({ kind: ValueSourceKind.Env, value: 'TOKEN' })).toBe('secret')
    })
    test('missing or empty env returns undefined', () => {
        expect(r.resolve({ kind: ValueSourceKind.Env, value: 'NOPE' })).toBeUndefined()
        expect(r.resolve({ kind: ValueSourceKind.Env, value: 'EMPTY' })).toBeUndefined()
    })
})
