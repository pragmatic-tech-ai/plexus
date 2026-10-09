import { describe, it, expect } from 'vitest'
import type { TypeCheckRequest, TypeCheckResult } from '@pragmatic-tech-ai/todl/build-system-core'
import { IpcTypeChecker } from '../ipc-type-checker.js'

describe('IpcTypeChecker', () =>
{
    it('forwards the request to window.api.typeCheck.Check', async () =>
    {
        const request: TypeCheckRequest = { Files: [], Options: {} as never }
        const expected: TypeCheckResult = { Diagnostics: [] }
        let seen: TypeCheckRequest | undefined
        ;(globalThis as unknown as { api: unknown }).api = {
            typeCheck: { Check: async (r: TypeCheckRequest) => { seen = r; return expected } },
        }
        const result = await new IpcTypeChecker().Check(request)
        expect(seen).toBe(request)
        expect(result).toBe(expected)
    })

    it('throws a clear error when the bridge is absent', async () =>
    {
        ;(globalThis as unknown as { api: unknown }).api = {}
        await expect(new IpcTypeChecker().Check({ Files: [], Options: {} as never })).rejects.toThrow(/preload bridge/)
    })
})
