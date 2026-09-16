import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ClipboardService } from '../clipboard-service.js'

test('writeText forwards to the injected writer', async () => {
    const provider = new ServiceProvider()
    const written: string[] = []
    const svc = new ClipboardService(provider, async (t) => { written.push(t) })
    await svc.writeText('hello')
    expect(written).toEqual(['hello'])
})
