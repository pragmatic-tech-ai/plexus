import { type IServiceContainer, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService, type IStorageProviderRegistry } from "@pragmatic-tech-ai/todl";
import { type IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import { StorageService } from "../storage/index.js";
import { DialogPromptService } from "./dialog-prompt-service.js";

// Registers the GENERIC engine host seams a Mural/Plexus shell supplies for the
// SolutionManagerService: the user-decision prompt service (over DialogService) and
// the storage-provider registry (aliasing the already-composed StorageService). This
// is DI-composition glue — the storage alias resolves an EXISTING service, a shape
// .mu's `.services:` can't express — so it lives in TS, invoked by the host alongside
// the engine module. The app-specific seams (package source, project factory) stay
// with the app.
export class SolutionSeams
{
  // promptFactory lets a host supply a fuller IPromptService (e.g. the desktop
  // DesktopPromptService, which adds native folder/file pickers over its bridge);
  // the default is the generic DialogPromptService a non-desktop Mural shell uses.
  public static Register(
    services: IServiceContainer,
    promptFactory: (p: IServiceProvider) => IPromptService = (p: IServiceProvider): IPromptService => new DialogPromptService(p.getRequired(DialogService.Key)),
  ): void
  {
    services.register(SolutionManagerService.PromptServiceKey, promptFactory);
    services.register(
      SolutionManagerService.StorageRegistryKey,
      // Must resolve StorageService.Key directly: routing via the facade would be a composition cycle (facade depends on this manager).
      (p: IServiceProvider): IStorageProviderRegistry => p.getRequired(StorageService.Key),
    );
  }
}
