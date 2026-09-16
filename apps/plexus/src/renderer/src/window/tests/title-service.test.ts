import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TitleService, type ITitleSource } from '../title-service.js'

// A controllable title source: mutate the two values, then fire() to notify.
function fakeSource(): ITitleSource & { doc?: string; project?: string; fire: () => void }
{
    const listeners = new Set<() => void>()
    const s = {
        doc: undefined as string | undefined,
        project: undefined as string | undefined,
        activeDocumentTitle: () => s.doc,
        firstProjectName: () => s.project,
        subscribe: (onChange: () => void) => { listeners.add(onChange); return () => listeners.delete(onChange) },
        fire: () => { for (const l of listeners) l() },
    }
    return s
}

function serviceWith(source: ITitleSource): TitleService
{
    // A bare container satisfies ServiceBase(provider); the fake source means the
    // service never touches the real shell services.
    const provider = new ServiceProvider()
    return new TitleService(provider, source)
}

describe('TitleService', () => {
    it('defaults to "Plexus" when neither a document nor a project is present', () => {
        const svc = serviceWith(fakeSource())
        expect(svc.Title).toBe('Plexus')
    })

    it('prefers the active document title', () => {
        const src = fakeSource()
        src.doc = 'Orders.diagram'
        src.project = 'Billing'
        expect(serviceWith(src).Title).toBe('Orders.diagram')
    })

    it('falls back to the first open project name when no document is active', () => {
        const src = fakeSource()
        src.project = 'Billing'
        expect(serviceWith(src).Title).toBe('Billing')
    })

    it('recomputes on source change', () => {
        const src = fakeSource()
        const svc = serviceWith(src)
        expect(svc.Title).toBe('Plexus')
        src.project = 'Billing'
        src.fire()
        expect(svc.Title).toBe('Billing')
        src.doc = 'Orders.diagram'
        src.fire()
        expect(svc.Title).toBe('Orders.diagram')
    })
})
