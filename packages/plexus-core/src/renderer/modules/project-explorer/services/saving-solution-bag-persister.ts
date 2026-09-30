import type { IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import { BagScope, SolutionBagPersister, type IBagPersister, type Solution, type SolutionManagerService } from '@pragmatic-tech-ai/todl'

// A solution-scope IBagPersister for the active solution whose Flush persists. SolutionBagPersister
// itself only mutates the live Solution (its own Flush is a no-op — solution bags serialize through
// SolutionManagerService.Save, not a file the persister owns), so this app-side adapter delegates
// every read/write to it and makes Flush trigger the manager's Save (skipped for an untitled
// solution with no on-disk location, matching the previous solution.json behaviour).
export class SavingSolutionBagPersister implements IBagPersister
{
    public readonly Scope = BagScope.Solution

    private readonly inner: SolutionBagPersister

    constructor(solution: Solution, private readonly manager: SolutionManagerService)
    {
        this.inner = new SolutionBagPersister(solution)
    }

    public Ids(kind: string): readonly string[]
    {
        return this.inner.Ids(kind)
    }

    public Bag(kind: string, id: string): IPropertyBag
    {
        return this.inner.Bag(kind, id)
    }

    public Create(kind: string, id: string): IPropertyBag
    {
        return this.inner.Create(kind, id)
    }

    public Delete(kind: string, id: string): void
    {
        this.inner.Delete(kind, id)
    }

    public async Flush(): Promise<void>
    {
        if (this.manager.ActiveSolution?.HasLocation === true) await this.manager.Save()
    }
}
