import { describe, it, expect } from 'vitest'
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { type Solution, type SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { SolutionOrigins, SolutionOriginKind } from '../solution-origin.js'

// The origin helper ignores the Solution's internals (nothing on it records an
// origin yet), so a bare object stands in for a Solution.
const AnySolution = {} as unknown as Solution

class FakeManager extends Observable
{
    constructor(private active: Solution | undefined)
    {
        super()
    }

    public get ActiveSolution(): Solution | undefined { return this.active }
}

function managerWith(active: Solution | undefined): SolutionManagerService
{
    return new FakeManager(active) as unknown as SolutionManagerService
}

describe('SolutionOrigins', () =>
{
    it('reports a file-system origin for every solution today', () =>
    {
        expect(SolutionOrigins.Of(AnySolution).Kind).toBe(SolutionOriginKind.FileSystem)
    })

    it('labels a file-system origin', () =>
    {
        expect(SolutionOrigins.Label(SolutionOrigins.FileSystem)).toBe('File system')
    })

    it('labels a dev-environment origin with its name', () =>
    {
        expect(SolutionOrigins.Label({ Kind: SolutionOriginKind.DevEnvironment, EnvironmentName: 'loop-dev' })).toBe('Dev environment: loop-dev')
    })

    it('has no active label when no manager is present', () =>
    {
        expect(SolutionOrigins.ActiveLabel(undefined)).toBeUndefined()
    })

    it('has no active label when no solution is open', () =>
    {
        expect(SolutionOrigins.ActiveLabel(managerWith(undefined))).toBeUndefined()
    })

    it('labels the active solution when one is open', () =>
    {
        expect(SolutionOrigins.ActiveLabel(managerWith(AnySolution))).toBe('File system')
    })
})
