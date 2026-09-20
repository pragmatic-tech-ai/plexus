import { type IServiceContainer } from "@pragmatic-tech-ai/mural/runtime";
import {
  SolutionManagerService,
  type IProjectFactoryRegistry,
  type IProjectFactory,
} from "@pragmatic-tech-ai/todl";
import { SolutionWorkspaceHostKey } from "@pragmatic-tech-ai/plexus-core/renderer/modules/solution-studio";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { IpcPackageSource } from "./ipc-package-source.js";
import { RegistrySolutionWorkspaceHost } from "./registry-solution-workspace-host.js";
import { TodlPackageProjectFactory, TODL_PACKAGE_TYPE } from "./todl-package-project-factory.js";

// Resolves a project type id to the factory that opens it. This app ships one
// project type (the TODL package); later modules register more types here.
export class TodlProjectFactoryRegistry implements IProjectFactoryRegistry
{
  private readonly todlPackage = new TodlPackageProjectFactory();

  public factoryFor(typeId: string): IProjectFactory | undefined
  {
    return typeId === TODL_PACKAGE_TYPE ? this.todlPackage : undefined;
  }

  public All(): readonly IProjectFactory[]
  {
    return [this.todlPackage];
  }
}

// Registers the APP-SPECIFIC solution seams — the ones only this app knows:
//   • the project-factory registry (which project types it opens),
//   • the Domain package source (IpcPackageSource, over the main-side registry), and
//   • the Solution Explorer's workspace host (folder pick / connection list / member
//     compile / connection routing — the plexus-core panel's ISolutionWorkspaceHost).
// The generic seams (prompt service, storage-provider registry) come from
// SolutionStudioSeams (plexus-core); the engine services themselves from
// SolutionServicesEngine (@pragmatic-tech-ai/todl, added imperatively from main.ts).
export class SolutionServicesRegistration
{
  public static Register(services: IServiceContainer): void
  {
    services.register(
      SolutionManagerService.ProjectFactoryRegistryKey,
      (): IProjectFactoryRegistry => new TodlProjectFactoryRegistry(),
    );
    services.register(
      SolutionManagerService.PackageSourceKey,
      (p) => new IpcPackageSource(p.getRequired(RegistryClient)),
    );
    services.register(
      SolutionWorkspaceHostKey,
      (p) => new RegistrySolutionWorkspaceHost(
        p.getRequired(RegistryClient),
        p.getRequired(SolutionManagerService.PackageSourceKey) as IpcPackageSource,
      ),
    );
  }
}
