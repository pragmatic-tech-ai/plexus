import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { TitleService, TitleSourceKey, type ITitleSource } from '../title-service.js'

// A controllable ITitleSource: the two title parts are mutable and `fire()`
// replays the subscribed change callback so recompute is testable.
function makeSource(doc: string | undefined, project: string | undefined, suffix?: string | undefined): {
    source: ITitleSource
    setDoc: (v: string | undefined) => void
    setSuffix: (v: string | undefined) => void
    fire: () => void
}
{
    let d = doc
    let s = suffix
    let cb: () => void = () => {}
    const source: ITitleSource = {
        appName: 'TestApp',
        activeDocumentTitle: () => d,
        firstProjectName: () => project,
        contextSuffix: () => s,
        subscribe: (onChange) => { cb = onChange; return () => {} },
    }
    return { source, setDoc: (v) => { d = v }, setSuffix: (v) => { s = v }, fire: () => cb() }
}

function serviceFor(source: ITitleSource): TitleService
{
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

test('Title appends the context suffix to the base title', () => {
    expect(serviceFor(makeSource('Doc', 'Proj', 'File system').source).Title).toBe('Doc · File system')
})

test('Title appends the suffix to the project name when no document is open', () => {
    expect(serviceFor(makeSource(undefined, 'Proj', 'File system').source).Title).toBe('Proj · File system')
})

test('Title omits the suffix when the source has none', () => {
    expect(serviceFor(makeSource('Doc', 'Proj', undefined).source).Title).toBe('Doc')
})

test('Title recomputes when the suffix changes', () => {
    const s = makeSource('Doc', 'Proj', undefined)
    const svc = serviceFor(s.source)
    expect(svc.Title).toBe('Doc')
    s.setSuffix('Dev environment: loop-dev')
    s.fire()
    expect(svc.Title).toBe('Doc · Dev environment: loop-dev')
})

test('Title recomputes when the source fires a change', () => {
    const s = makeSource('A', undefined)
    const svc = serviceFor(s.source)
    expect(svc.Title).toBe('A')
    s.setDoc('B')
    s.fire()
    expect(svc.Title).toBe('B')
})
