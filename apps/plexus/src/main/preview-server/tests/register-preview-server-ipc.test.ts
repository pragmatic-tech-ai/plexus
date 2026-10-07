import { test, expect } from 'vitest'
import { registerPreviewServerIpc } from '../register-preview-server-ipc.js'
import { PreviewServerChannel } from '../../../shared/preview-server-api.js'

test('Start handler delegates to the manager and returns its info', async () =>
{
    const handlers = new Map<string, (...a: any[]) => any>()
    const ipc = { handle: (ch: string, fn: any) => handlers.set(ch, fn) } as any
    const mgr = { Start: (root: string) => Promise.resolve({ url: 'http://127.0.0.1:4599', port: 4599, root }), Stop: () => Promise.resolve(), StopAll: () => Promise.resolve() } as any
    registerPreviewServerIpc(ipc, mgr)
    const out = await handlers.get(PreviewServerChannel.Start)!({}, '/proj/build/html-bundle')
    expect(out.url).toBe('http://127.0.0.1:4599')
})
