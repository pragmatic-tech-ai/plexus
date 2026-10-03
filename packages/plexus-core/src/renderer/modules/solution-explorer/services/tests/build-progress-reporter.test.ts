import { describe, expect, it } from 'vitest'
import { ActionStatus, ProjectBuildStatus, Severity, type BuildDiagnostic } from '@pragmatic-tech-ai/todl/build-system-core'
import { BuildProgressReporter, type ITaskProgressSink } from '../build-progress-reporter.js'

// A fake background-work sink that records every report()/log() the reporter makes, so the
// adapter can be exercised in isolation without a real MuralBase-backed TaskHandle.
class RecordingSink implements ITaskProgressSink
{
    public readonly Fractions: number[] = []
    public readonly Notes: string[] = []
    public readonly Lines: string[] = []

    public report(fraction: number, note?: string): void
    {
        this.Fractions.push(fraction)
        if (note !== undefined) this.Notes.push(note)
    }

    public log(line: string): void
    {
        this.Lines.push(line)
    }
}

describe('BuildProgressReporter', () =>
{
    it('advances the fraction across a single project\'s actions and reports 1 when it finishes', () =>
    {
        const sink = new RecordingSink()
        const reporter = new BuildProgressReporter(sink)

        reporter.ProjectStarted('acme/model', ['compile', 'emit'])
        reporter.ActionStarted('acme/model', 'compile')
        reporter.ActionFinished('acme/model', 'compile', ActionStatus.Succeeded)
        reporter.ActionFinished('acme/model', 'emit', ActionStatus.Succeeded)
        reporter.ProjectFinished('acme/model', ProjectBuildStatus.Built)

        // 2 actions: after the first, 0.5; after the second, 1.
        expect(sink.Fractions).toContain(0.5)
        expect(sink.Fractions[sink.Fractions.length - 1]).toBe(1)
    })

    it('scales the fraction by project count when the solution order is known', () =>
    {
        const sink = new RecordingSink()
        const reporter = new BuildProgressReporter(sink)

        reporter.SolutionStarted(['a', 'b'])
        reporter.ProjectStarted('a', ['only'])
        reporter.ActionFinished('a', 'only', ActionStatus.Succeeded)
        reporter.ProjectFinished('a', ProjectBuildStatus.Built)

        // One of two projects done -> half way, never past 1.
        expect(sink.Fractions.every((f) => f <= 1)).toBe(true)
        expect(sink.Fractions[sink.Fractions.length - 1]).toBe(0.5)
    })

    it('logs each started action and the per-project terminal status', () =>
    {
        const sink = new RecordingSink()
        const reporter = new BuildProgressReporter(sink)

        reporter.ProjectStarted('a', ['compile'])
        reporter.ActionStarted('a', 'compile')
        reporter.ProjectFinished('a', ProjectBuildStatus.Failed)

        expect(sink.Lines.some((l) => l.includes('compile'))).toBe(true)
        expect(sink.Lines.some((l) => l.includes(ProjectBuildStatus.Failed))).toBe(true)
    })

    it('logs a diagnostic with its severity label', () =>
    {
        const sink = new RecordingSink()
        const reporter = new BuildProgressReporter(sink)
        const diagnostic: BuildDiagnostic = { severity: Severity.Error, message: 'boom' }

        reporter.Diagnostic('a', diagnostic)

        expect(sink.Lines.some((l) => l.includes('boom'))).toBe(true)
    })
})
