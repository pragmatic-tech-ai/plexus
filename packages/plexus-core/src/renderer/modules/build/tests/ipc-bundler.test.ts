import { describe, it, expect, afterEach } from 'vitest'
import { IpcBundler } from '../ipc-bundler.js'

describe('IpcBundler', () =>
{
    afterEach(() =>
    {
        delete (globalThis as unknown as { api?: unknown }).api
    })

    it('forwards the request to window.api.bundle and returns its result', async () =>
    {
        ;(globalThis as unknown as { api: unknown }).api = {
            bundle: { Bundle: async (r: { Entry: string }) => ({ Text: 'ok:' + r.Entry, Diagnostics: [] }) },
        }
        const result = await new IpcBundler().BundleApp({ Entry: 'e', Files: [] } as never)
        expect(result).toEqual({ Text: 'ok:e', Diagnostics: [] })
    })

    it('throws synchronously when window.api.bundle is missing', () =>
    {
        ;(globalThis as unknown as { api: unknown }).api = {}
        expect(() => new IpcBundler().BundleApp({ Entry: 'e', Files: [] } as never))
            .toThrow('window.api.bundle is unavailable')
    })
})
