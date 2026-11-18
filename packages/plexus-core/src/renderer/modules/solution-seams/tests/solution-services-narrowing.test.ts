import { describe, test, expect } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionManagerService, SolutionLanguageService, BuildService } from '@pragmatic-tech-ai/todl'
import type { IManager, IBuildService, ILanguageService, IBaseResolver } from '@pragmatic-tech-ai/todl'
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

  public LanguageOf(): ILanguageService & IBaseResolver
  {
    return this.services.Language
  }
}

class NarrowingFixture
{
  public static readonly Host = new HostKind('narrowing-test')

  public readonly Language = { Tag: 'language' } as unknown as SolutionLanguageService
  public readonly Build = { Tag: 'build' } as unknown as BuildService

  public Compose()
  {
    const provider = new ShellCompositionRoot(NarrowingFixture.Host).Provider
    const manager = { ActiveSolution: { Name: 'sln' } } as unknown as SolutionManagerService
    provider.registerInstance(SolutionManagerService.Key, manager)
    provider.registerInstance(SolutionLanguageService.Key, this.Language)
    provider.registerInstance(StorageService.Key, {} as unknown as StorageService)
    provider.registerInstance(BuildService.Key, this.Build)
    return provider
  }
}

describe('ISolutionServices narrowing', () =>
{
  test('IntegratedSolutionServices satisfies the interface-typed facade', () =>
  {
    const fixture = new NarrowingFixture()
    const services: ISolutionServices = new IntegratedSolutionServices(fixture.Compose())
    const reader = new ActiveSolutionReader(services)
    expect(reader.ActiveName()).toBe('sln')
    expect(reader.LanguageOf()).toBe(fixture.Language)
    expect(reader.BuildOf()).toBe(fixture.Build)
  })
})
