import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { SolutionManagerService, SolutionLanguageService, BuildService } from '@pragmatic-tech-ai/todl';
import { StorageService } from '../storage/index.js';
import { SolutionServices, type ISolutionServices } from './solution-services.js';

// In-process implementation: every accessor delegates to the TODL service singleton
// resolved lazily from the DI provider (so registration order is irrelevant).
export class IntegratedSolutionServices implements ISolutionServices
{
  // Registering this class in a .mu `.services:` block files it under this token.
  public static readonly Key = SolutionServices.Key;

  private readonly provider: IServiceProvider;

  constructor(provider: IServiceProvider)
  {
    this.provider = provider;
  }

  public get Manager(): SolutionManagerService
  {
    return this.provider.getRequired(SolutionManagerService.Key);
  }

  public get Language(): SolutionLanguageService
  {
    return this.provider.getRequired(SolutionLanguageService.Key);
  }

  public get Build(): BuildService | undefined
  {
    return this.provider.get(BuildService.Key);
  }

  public get Storage(): StorageService
  {
    return this.provider.getRequired(StorageService.Key);
  }
}
