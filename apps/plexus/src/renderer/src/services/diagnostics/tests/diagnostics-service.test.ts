import { test, expect, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '../diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../diagnostic.js'

function diag(over: Partial<Diagnostic>): Diagnostic
{
    return {
        owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
        message: 'm', severity: DiagnosticSeverity.Error, span: null, ...over,
    }
}

function svc(): DiagnosticsService { return new DiagnosticsService(new ServiceProvider()) }

test('Publish replaces the whole (owner, project) slice', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' }), diag({ uri: 'b.todl' })])
    expect(s.All.Count).toBe(2)
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])   // republish: b's diagnostic is gone
    expect(s.All.Count).toBe(1)
    expect(s.ForUri('b.todl')).toEqual([])
})

test('Publish keeps other owners and other projects intact', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])
    s.Publish('todl', '/q', [diag({ projectId: '/q', uri: 'a.todl' })])
    s.Publish('lint', '/p', [diag({ owner: 'lint', uri: 'a.todl' })])
    expect(s.All.Count).toBe(3)
    s.Publish('todl', '/p', [])                          // clear only todl@/p
    expect(s.All.Count).toBe(2)
})

test('ClearProject drops all owners for that project only', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])
    s.Publish('lint', '/p', [diag({ owner: 'lint', uri: 'a.todl' })])
    s.Publish('todl', '/q', [diag({ projectId: '/q', uri: 'a.todl' })])
    s.ClearProject('/p')
    expect(s.All.Count).toBe(1)
    expect(s.All.Get(0)!.projectId).toBe('/q')
})

test('ForUri returns only that file\'s diagnostics', () => {
    const s = svc()
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' }), diag({ uri: 'b.todl' }), diag({ uri: null })])
    expect(s.ForUri('a.todl').length).toBe(1)
    expect(s.ForUri('b.todl').length).toBe(1)
    expect(s.ForUri('a.todl')[0]!.uri).toBe('a.todl')
})

test('SubscribeUri fires immediately then on each change; unsubscribe stops it', () => {
    const s = svc()
    const seen: number[] = []
    const listener = vi.fn((d: Diagnostic[]) => seen.push(d.length))
    const unsub = s.SubscribeUri('a.todl', listener)
    expect(seen).toEqual([0])                             // immediate empty snapshot
    s.Publish('todl', '/p', [diag({ uri: 'a.todl' })])
    expect(seen).toEqual([0, 1])
    unsub()
    s.Publish('todl', '/p', [])                           // no further calls after unsub
    expect(seen).toEqual([0, 1])
})
