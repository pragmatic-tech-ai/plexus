import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import type { IManager, ILanguageService, IBaseResolver, IBuildService } from '@pragmatic-tech-ai/todl';
import type { StorageService } from '../storage/index.js';

// The single facade over the solution-scoped services a consumer needs. Typed against
// engine interfaces (not the concrete classes) so a remote implementation can stand in.
export interface ISolutionServices
{
  readonly Manager: IManager;
  readonly Language: ILanguageService & IBaseResolver;
  // Optional: absent when no build seams are registered (callers keep their own fallback).
  readonly Build: IBuildService | undefined;
  readonly Storage: StorageService;
}

// Holder of the facade's DI token.
export class SolutionServices
{
  private static readonly KeyName = 'SolutionServices';

  public static readonly Key = new ServiceKey<ISolutionServices>(SolutionServices.KeyName);
}
