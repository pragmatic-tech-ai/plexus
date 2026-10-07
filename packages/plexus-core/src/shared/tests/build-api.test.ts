import { describe, it, expect } from 'vitest'
import { BuildChannel, BuildProgressKind } from '../build-api.js'

describe('build wire contract', () =>
{
    it('pins the IPC channel strings', () =>
    {
        expect(BuildChannel.Run).toBe('build:run')
        expect(BuildChannel.Applicable).toBe('build:applicable')
        expect(BuildChannel.Progress).toBe('build:progress')
    })

    it('pins the progress-kind discriminants', () =>
    {
        expect(BuildProgressKind.SolutionStarted).toBe('solution-started')
        expect(BuildProgressKind.Diagnostic).toBe('diagnostic')
    })
})
