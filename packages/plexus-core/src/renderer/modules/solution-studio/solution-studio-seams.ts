import { type IServiceContainer, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService, type IStorageProviderRegistry } from "@pragmatic-tech-ai/todl";
import { type IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import { StorageService } from "../storage/index.js";
import { DialogPromptService } from "./dialog-prompt-service.js";

// Registers the GENERIC engine host seams a Mural/Plexus shell can supply for the
// SolutionManagerService: the user-decision prompt service (over DialogService) and
// the storage-provider registry (aliasing the already-composed StorageService). This
// is DI-composition glue — the storage alias resolves an EXISTING service, a shape
// .mu's `.services:` can't express — so it lives in TS, invoked by the host alongside
// the engine module. The presentation (panel + Capability) is SolutionStudioModule
// (.mu); the app-specific seams (workspace host, package source, project factory)
// stay with the app.
export class SolutionStudioSeams {
  public static Register(services: IServiceContainer): void {
    services.register(
      SolutionManagerService.PromptServiceKey,
      (p: IServiceProvider): IPromptService => new DialogPromptService(p.getRequired(DialogService.Key)),
    );
    services.register(
      SolutionManagerService.StorageRegistryKey,
      (p: IServiceProvider): IStorageProviderRegistry => p.getRequired(StorageService.Key),
    );
  }
}
