import { describe, it, expect } from 'vitest'
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { type Solution, type SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { TargetSource } from '../../../../../shared/account-api.js'
import { SolutionOrigins, SolutionOriginKind } from '../solution-origin.js'
import { SolutionOriginRegistry } from '../solution-origin-registry.js'

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
        expect(SolutionOrigins.Label({ Kind: SolutionOriginKind.DevEnvironment, EnvironmentName: 'loop-dev', EnvironmentRef: { Name: 'loop-dev', Source: TargetSource.Console }, SolutionName: 'sol' })).toBe('Dev environment: loop-dev')
    })

    it('builds a dev-environment origin carrying ref and solution', () =>
    {
        const origin = SolutionOrigins.DevEnvironment({ Name: 'loop-dev', Source: TargetSource.Console }, 'sol')
        expect(origin.Kind).toBe(SolutionOriginKind.DevEnvironment)
        expect(origin.EnvironmentName).toBe('loop-dev')
        expect(origin.EnvironmentRef).toEqual({ Name: 'loop-dev', Source: TargetSource.Console })
        expect(origin.SolutionName).toBe('sol')
        expect(SolutionOrigins.Label(origin)).toBe('Dev environment: loop-dev')
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

describe('SolutionOrigins with a registry', () =>
{
    const ref = { Source: TargetSource.Cloud, Name: 'dev1' } as unknown as Parameters<SolutionOriginRegistry['Register']>[1]

    it('detects a registered solution as DevEnvironment and labels it', () =>
    {
        const registry = new SolutionOriginRegistry()
        registry.Register(AnySolution, ref, 'sol')
        const origin = SolutionOrigins.Of(AnySolution, registry)
        expect(origin.Kind).toBe(SolutionOriginKind.DevEnvironment)
        expect(SolutionOrigins.ActiveLabel(managerWith(AnySolution), registry)).toBe('Dev environment: dev1')
    })

    it('falls back to FileSystem for an unregistered solution', () =>
    {
        const registry = new SolutionOriginRegistry()
        expect(SolutionOrigins.Of(AnySolution, registry).Kind).toBe(SolutionOriginKind.FileSystem)
        expect(SolutionOrigins.ActiveLabel(managerWith(AnySolution), registry)).toBe('File system')
    })
})
