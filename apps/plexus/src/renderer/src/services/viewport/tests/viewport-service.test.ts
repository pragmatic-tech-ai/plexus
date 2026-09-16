import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ViewportService, type IViewportSource } from '../viewport-service.js'

// A fake window: lets the test push a new size and fire the resize callback.
function fakeSource(h0: number, w0 = 1200): IViewportSource & { push(w: number, h: number): void }
{
    let h = h0, w = w0
    const cbs = new Set<() => void>()
    return {
        height: () => h,
        width: () => w,
        subscribe: (cb) => { cbs.add(cb); return () => cbs.delete(cb) },
        push: (nw: number, nh: number) => { w = nw; h = nh; for (const cb of cbs) cb() },
    }
}

test('Height and Width reflect the source at construction', () => {
    const provider = new ServiceProvider()
    const svc = new ViewportService(provider, fakeSource(900, 1400))
    expect(svc.Height).toBe(900)
    expect(svc.Width).toBe(1400)
})

test('Height/Width update and Subscribe fires when the source resizes', () => {
    const provider = new ServiceProvider()
    const source = fakeSource(900, 1400)
    const svc = new ViewportService(provider, source)
    let notified = 0
    svc.Subscribe(() => { notified += 1 })
    source.push(1000, 600)
    expect(svc.Height).toBe(600)
    expect(svc.Width).toBe(1000)
    expect(notified).toBe(1)
})
