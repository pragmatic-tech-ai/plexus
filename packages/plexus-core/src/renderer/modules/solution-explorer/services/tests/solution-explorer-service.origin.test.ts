import { describe, it, expect } from 'vitest'
import { ServiceProvider, Observable } from '@pragmatic-tech-ai/mural/runtime'
import type { SolutionManagerService, Solution } from '@pragmatic-tech-ai/todl'
import { SolutionServices, type ISolutionServices } from '../../../solution-seams/index.js'
import { SolutionExplorerService } from '../solution-explorer-service.js'

// The origin getter reads only the manager's ActiveSolution, so a bare object
// stands in for a Solution and a minimal fake manager for the service.
const AnySolution = {} as unknown as Solution

class FakeManager extends Observable
{
    private active: Solution | undefined

    public get ActiveSolution(): Solution | undefined { return this.active }

    public Swap(next: Solution | undefined): void
    {
        const old = this.active
        this.active = next
        this.RaisePropertyChanged('ActiveSolution', old, next)
    }
}

function serviceWith(manager: FakeManager): SolutionExplorerService
{
    const provider = new ServiceProvider()
    provider.registerInstance(SolutionServices.Key, { Manager: manager as unknown as SolutionManagerService } as unknown as ISolutionServices)
    return new SolutionExplorerService(provider)
}

describe('SolutionExplorerService.OriginLabel', () =>
{
    it('is empty when no solution is open', () =>
    {
        expect(serviceWith(new FakeManager()).OriginLabel).toBe('')
    })

    it('is empty and does not throw when the solution-services facade is not registered', () =>
    {
        expect(new SolutionExplorerService(new ServiceProvider()).OriginLabel).toBe('')
    })

    it('reports the file-system origin when a solution is open', () =>
    {
        const manager = new FakeManager()
        manager.Swap(AnySolution)
        expect(serviceWith(manager).OriginLabel).toBe('File system')
    })
})
