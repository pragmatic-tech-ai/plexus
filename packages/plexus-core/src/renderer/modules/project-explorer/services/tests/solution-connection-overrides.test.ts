import { describe, it, expect } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import type { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { SolutionConnectionOverrides } from '../solution-connection-overrides.js'

// A minimal SolutionManagerService stand-in exposing the two members the override store
// uses: the active solution and Save.
function managerWith(solution: Solution | undefined, onSave?: () => void): SolutionManagerService
{
    return {
        get ActiveSolution(): Solution | undefined { return solution },
        Save(): Promise<void> { onSave?.(); return Promise.resolve() },
    } as unknown as SolutionManagerService
}

describe('SolutionConnectionOverrides', () =>
{
    it('reads undefined when nothing is set (and when there is no active solution)', () =>
    {
        expect(new SolutionConnectionOverrides(managerWith(undefined)).Default()).toBeUndefined()
        const o = new SolutionConnectionOverrides(managerWith(new Solution('S', undefined)))
        expect(o.Default()).toBeUndefined()
        expect(o.OverrideFor('proj/a')).toBeUndefined()
    })

    it('round-trips the solution default and per-member overrides into solution.json settings', async () =>
    {
        const s = new Solution('S', undefined)
        const o = new SolutionConnectionOverrides(managerWith(s))

        await o.SetDefault('registry-x')
        await o.SetOverrideFor('proj/a', 'registry-y')

        expect(o.Default()).toBe('registry-x')
        expect(o.OverrideFor('proj/a')).toBe('registry-y')
        expect(o.OverrideFor('proj/b')).toBeUndefined()

        const persisted = s.CollectSettings()['connections']
        expect(persisted).toMatchObject({ 'proj/a': 'registry-y' })
    })

    it('clearing an override with undefined removes its effect', async () =>
    {
        const s = new Solution('S', undefined)
        const o = new SolutionConnectionOverrides(managerWith(s))

        await o.SetOverrideFor('proj/a', 'registry-y')
        await o.SetOverrideFor('proj/a', undefined)

        expect(o.OverrideFor('proj/a')).toBeUndefined()
    })

    it('does not Save an untitled (location-less) solution but keeps the value in memory', async () =>
    {
        let saves = 0
        const s = new Solution('S', undefined)
        const o = new SolutionConnectionOverrides(managerWith(s, () => { saves += 1 }))

        await o.SetDefault('registry-x')

        expect(saves).toBe(0)
        expect(o.Default()).toBe('registry-x')
    })
})
