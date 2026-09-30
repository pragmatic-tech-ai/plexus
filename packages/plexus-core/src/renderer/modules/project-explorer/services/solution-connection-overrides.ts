import { SettingBagDefinition } from '@pragmatic-tech-ai/todl'
import type { Solution, SolutionManagerService, SolutionSettingBag } from '@pragmatic-tech-ai/todl'

// The per-project connection choices for the active solution, persisted in solution.json
// (NOT the shareable project manifest). Backed by a `connections` solution setting bag whose
// dynamic keys are member paths (→ that member's connection id) plus one reserved key for the
// solution-wide default. todl serializes the bag's values through CollectSettings, so overrides
// round-trip with the solution; writes persist via SolutionManagerService.Save (skipped for an
// untitled solution with no on-disk location — the value stays in memory until the next save).
export class SolutionConnectionOverrides
{
    private static readonly BagId = 'connections'
    private static readonly BagTitle = 'Connections'
    private static readonly DefaultKey = '__default__'
    private static readonly definition = new SettingBagDefinition(SolutionConnectionOverrides.BagId, SolutionConnectionOverrides.BagTitle, [])

    constructor(private readonly manager: SolutionManagerService)
    {
    }

    // The solution-wide default connection id, or undefined when none is chosen.
    public Default(): string | undefined
    {
        return this.read(SolutionConnectionOverrides.DefaultKey)
    }

    // The per-member override connection id, or undefined when the member follows the default.
    public OverrideFor(memberKey: string): string | undefined
    {
        return this.read(memberKey)
    }

    public SetDefault(id: string | undefined): Promise<void>
    {
        return this.write(SolutionConnectionOverrides.DefaultKey, id)
    }

    public SetOverrideFor(memberKey: string, id: string | undefined): Promise<void>
    {
        return this.write(memberKey, id)
    }

    // The `connections` bag for the active solution, bound on first use (idempotent per id,
    // overlaying any values loaded from solution.json). Undefined when no solution is open.
    private bag(): SolutionSettingBag | undefined
    {
        const solution: Solution | undefined = this.manager.ActiveSolution
        if (solution === undefined) return undefined
        solution.BindBags([SolutionConnectionOverrides.definition])
        return solution.SettingBags.ToArray().find((b) => b.Definition.Id === SolutionConnectionOverrides.BagId)
    }

    private read(key: string): string | undefined
    {
        const value = this.bag()?.Get(key)
        return typeof value === 'string' && value.length > 0 ? value : undefined
    }

    private async write(key: string, id: string | undefined): Promise<void>
    {
        const bag = this.bag()
        if (bag === undefined) return
        bag.Set(key, id ?? '')
        if (this.manager.ActiveSolution?.HasLocation === true) await this.manager.Save()
    }
}
