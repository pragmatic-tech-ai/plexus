import { ServiceLifetime, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { ShellModule, DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService, type IStorageProviderRegistry } from "@pragmatic-tech-ai/todl";
import { type IPromptService } from "@pragmatic-tech-ai/todl-runtime";
import { StorageService } from "../storage/index.js";
import { DialogPromptService } from "./dialog-prompt-service.js";

// SolutionServicesStudio — the PRESENTATION-band host services for the solution
// engine, packaged as a shell module a Mural/Plexus app lists in its `.modules:`
// block. It binds the two seams a generic Mural shell can supply for the
// SolutionManagerService:
//   • the user-decision prompt service (over Mural's DialogService), and
//   • the storage-provider registry (aliasing the already-composed StorageService).
//
// The engine services themselves (SolutionManagerService + its settings registry)
// are registered by SolutionServicesEngine — a plain IModule in
// `@pragmatic-tech-ai/todl`, loaded imperatively by the app. The remaining,
// app-specific seams the manager resolves (the package source, the project-factory
// registry) stay with the app that knows them: Studio ships only what a generic
// shell can serve.
class SolutionStudioShellModule extends ShellModule {
  constructor() {
    super();
    this.Name = "Solution Studio";

    // The engine asks the user (e.g. discard unsaved changes) through this.
    this.AddRegistration(
      SolutionManagerService.PromptServiceKey,
      (p: IServiceProvider): IPromptService => new DialogPromptService(p.getRequired(DialogService.Key)),
      ServiceLifetime.Singleton,
    );

    // Alias the shell's StorageService as the engine's storage-provider registry.
    // The Storage module already composed StorageService; this only surfaces it
    // under the manager's key (no second instance).
    this.AddRegistration(
      SolutionManagerService.StorageRegistryKey,
      (p: IServiceProvider): IStorageProviderRegistry => p.getRequired(StorageService.Key),
      ServiceLifetime.Singleton,
    );
  }
}

// The composed module instance an app lists in its `.modules:` block — a single
// instance (the composition unit), mirroring what a compiled `.mu` module lowers
// to (`export const X = new ShellModule(); X.AddRegistration(...)`).
export const SolutionStudioModule = new SolutionStudioShellModule();
