import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TitleService, TitleSourceKey, type ITitleSource } from '../title-service.js'

// A controllable ITitleSource: the two title parts are mutable and `fire()`
// replays the subscribed change callback so recompute is testable.
function makeSource(doc: string | undefined, project: string | undefined): {
    source: ITitleSource
    setDoc: (v: string | undefined) => void
    fire: () => void
} {
    let d = doc
    let cb: () => void = () => {}
    const source: ITitleSource = {
        appName: 'TestApp',
        activeDocumentTitle: () => d,
        firstProjectName: () => project,
        subscribe: (onChange) => { cb = onChange; return () => {} },
    }
    return { source, setDoc: (v) => { d = v }, fire: () => cb() }
}

function serviceFor(source: ITitleSource): TitleService {
    const p = new ServiceProvider()
    p.registerInstance(TitleSourceKey, source)
    return new TitleService(p)
}

test('Title prefers the active document title', () => {
    expect(serviceFor(makeSource('Doc', 'Proj').source).Title).toBe('Doc')
})

test('Title falls back to the first project name', () => {
    expect(serviceFor(makeSource(undefined, 'Proj').source).Title).toBe('Proj')
})

test('Title falls back to the app name', () => {
    expect(serviceFor(makeSource(undefined, undefined).source).Title).toBe('TestApp')
})

test('Title recomputes when the source fires a change', () => {
    const s = makeSource('A', undefined)
    const svc = serviceFor(s.source)
    expect(svc.Title).toBe('A')
    s.setDoc('B')
    s.fire()
    expect(svc.Title).toBe('B')
})
