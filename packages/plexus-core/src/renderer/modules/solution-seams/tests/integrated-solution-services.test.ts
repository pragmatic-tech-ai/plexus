import { describe, test, expect } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionManagerService, SolutionLanguageService, BuildService } from '@pragmatic-tech-ai/todl'
import { StorageService } from '../../storage/index.js'
import { IntegratedSolutionServices } from '../integrated-solution-services.js'

class IntegratedFixture
{
  public static readonly Host = new HostKind('integrated-test')

  public Compose(registerBuild: boolean)
  {
    const provider = new ShellCompositionRoot(IntegratedFixture.Host).Provider
    provider.registerInstance(SolutionManagerService.Key, { Tag: 'm' } as unknown as SolutionManagerService)
    provider.registerInstance(SolutionLanguageService.Key, { Tag: 'l' } as unknown as SolutionLanguageService)
    provider.registerInstance(StorageService.Key, { Tag: 's' } as unknown as StorageService)
    if (registerBuild) provider.registerInstance(BuildService.Key, { Tag: 'b' } as unknown as BuildService)
    return provider
  }
}

describe('IntegratedSolutionServices', () =>
{
  test('exposes the same singleton instances resolved by the legacy keys', () =>
  {
    const provider = new IntegratedFixture().Compose(true)
    const services = new IntegratedSolutionServices(provider)
    expect(services.Manager).toBe(provider.getRequired(SolutionManagerService.Key))
    expect(services.Language).toBe(provider.getRequired(SolutionLanguageService.Key))
    expect(services.Storage).toBe(provider.getRequired(StorageService.Key))
    expect(services.Build).toBe(provider.getRequired(BuildService.Key))
  })

  test('Build accessor mirrors optional resolution (undefined when unregistered)', () =>
  {
    const provider = new IntegratedFixture().Compose(false)
    expect(new IntegratedSolutionServices(provider).Build).toBeUndefined()
  })
})
