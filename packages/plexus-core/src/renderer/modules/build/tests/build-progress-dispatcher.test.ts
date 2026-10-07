import { describe, it, expect } from 'vitest'
import { BuildProgressDispatcher } from '../build-progress-dispatcher.js'
import { BuildProgressKind } from '../../../../shared/build-api.js'

class Recorder
{
    public calls: [string, unknown[]][] = []
    public SolutionStarted(...a: unknown[]): void { this.calls.push(['SolutionStarted', a]) }
    public ProjectStarted(...a: unknown[]): void { this.calls.push(['ProjectStarted', a]) }
    public ActionStarted(...a: unknown[]): void { this.calls.push(['ActionStarted', a]) }
    public ActionFinished(...a: unknown[]): void { this.calls.push(['ActionFinished', a]) }
    public ProjectFinished(...a: unknown[]): void { this.calls.push(['ProjectFinished', a]) }
    public Diagnostic(...a: unknown[]): void { this.calls.push(['Diagnostic', a]) }
}

describe('BuildProgressDispatcher', () =>
{
    it('replays a Diagnostic event onto the matching IBuildProgress method', () =>
    {
        const r = new Recorder()
        BuildProgressDispatcher.Replay(r as never, { runId: 'R', kind: BuildProgressKind.Diagnostic, args: ['proj', { severity: 'error', message: 'x' }] })
        expect(r.calls).toEqual([['Diagnostic', ['proj', { severity: 'error', message: 'x' }]]])
    })

    it('replays ActionFinished with its status arg', () =>
    {
        const r = new Recorder()
        BuildProgressDispatcher.Replay(r as never, { runId: 'R', kind: BuildProgressKind.ActionFinished, args: ['proj', 'bundle-app', 'succeeded'] })
        expect(r.calls).toEqual([['ActionFinished', ['proj', 'bundle-app', 'succeeded']]])
    })

    it('replays every other kind onto its matching method', () =>
    {
        const cases: [BuildProgressKind, string, unknown[]][] = [
            [BuildProgressKind.SolutionStarted, 'SolutionStarted', [['a', 'b']]],
            [BuildProgressKind.ProjectStarted, 'ProjectStarted', ['a', ['x', 'y']]],
            [BuildProgressKind.ActionStarted, 'ActionStarted', ['a', 'x']],
            [BuildProgressKind.ProjectFinished, 'ProjectFinished', ['a', 'succeeded']],
        ]
        for (const [kind, method, args] of cases)
        {
            const r = new Recorder()
            BuildProgressDispatcher.Replay(r as never, { runId: 'R', kind, args })
            expect(r.calls).toEqual([[method, args]])
        }
    })
})
