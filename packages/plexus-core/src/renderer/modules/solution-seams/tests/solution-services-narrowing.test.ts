import { describe, test, expect } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionManagerService, SolutionLanguageService, BuildService } from '@pragmatic-tech-ai/todl'
import type { IManager, IBuildService } from '@pragmatic-tech-ai/todl'
import { StorageService } from '../../storage/index.js'
import { IntegratedSolutionServices } from '../integrated-solution-services.js'
import type { ISolutionServices } from '../solution-services.js'

// A representative consumer: reads the active solution through the narrowed facade only.
class ActiveSolutionReader
{
  public constructor(private readonly services: ISolutionServices)
  {
  }

  public ActiveName(): string | undefined
  {
    const manager: IManager = this.services.Manager
    return manager.ActiveSolution?.Name
  }

  public BuildOf(): IBuildService | undefined
  {
    return this.services.Build
  }
}

class NarrowingFixture
{
  public static readonly Host = new HostKind('narrowing-test')

  public Compose()
  {
    const provider = new ShellCompositionRoot(NarrowingFixture.Host).Provider
    const manager = { ActiveSolution: { Name: 'sln' } } as unknown as SolutionManagerService
    provider.registerInstance(SolutionManagerService.Key, manager)
    provider.registerInstance(SolutionLanguageService.Key, {} as unknown as SolutionLanguageService)
    provider.registerInstance(StorageService.Key, {} as unknown as StorageService)
    provider.registerInstance(BuildService.Key, {} as unknown as BuildService)
    return provider
  }
}

describe('ISolutionServices narrowing', () =>
{
  test('IntegratedSolutionServices satisfies the interface-typed facade', () =>
  {
    const services: ISolutionServices = new IntegratedSolutionServices(new NarrowingFixture().Compose())
    expect(new ActiveSolutionReader(services).ActiveName()).toBe('sln')
    expect(new ActiveSolutionReader(services).BuildOf()).toBeDefined()
  })
})
