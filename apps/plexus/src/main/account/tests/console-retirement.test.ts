import { describe, expect, it } from 'vitest'
import { ConsoleRetirement } from '../console-retirement.js'

describe('ConsoleRetirement', () =>
{
    it('names the server contract', () =>
    {
        expect(ConsoleRetirement.ErrorCode).toBe('console-not-registered')
        expect(ConsoleRetirement.CloseCode).toBe(4003)
        expect(ConsoleRetirement.Status).toBe(503)
    })

    it('IsBody is true only for a JSON object carrying the retired error', () =>
    {
        expect(ConsoleRetirement.IsBody('{"error":"console-not-registered","message":"x"}')).toBe(true)
        expect(ConsoleRetirement.IsBody('{"error":"unavailable"}')).toBe(false)
        expect(ConsoleRetirement.IsBody('<html>')).toBe(false)
        expect(ConsoleRetirement.IsBody('[]')).toBe(false)
        expect(ConsoleRetirement.IsBody('null')).toBe(false)
        expect(ConsoleRetirement.IsBody('')).toBe(false)
    })
})
