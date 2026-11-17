import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import type { SolutionManagerService, SolutionLanguageService, BuildService } from '@pragmatic-tech-ai/todl';
import type { StorageService } from '../storage/index.js';

// The single facade over the solution-scoped services a consumer needs. Typed against
// the concrete engine classes (Phase 1 is behavior-preserving; narrowing is Phase 2).
export interface ISolutionServices
{
  readonly Manager: SolutionManagerService;
  readonly Language: SolutionLanguageService;
  // Optional: absent when no build seams are registered (callers keep their own fallback).
  readonly Build: BuildService | undefined;
  readonly Storage: StorageService;
}

// Holder of the facade's DI token.
export class SolutionServices
{
  private static readonly KeyName = 'SolutionServices';

  public static readonly Key = new ServiceKey<ISolutionServices>(SolutionServices.KeyName);
}
