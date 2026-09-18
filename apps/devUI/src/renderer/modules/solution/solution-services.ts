import { type IServiceContainer } from "@pragmatic-tech-ai/mural/runtime";
import {
  SolutionManagerService,
  type IProjectFactoryRegistry,
  type IProjectFactory,
} from "@pragmatic-tech-ai/todl";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { IpcPackageSource } from "./ipc-package-source.js";
import { TodlPackageProjectFactory, TODL_PACKAGE_TYPE } from "./todl-package-project-factory.js";

// Resolves a project type id to the factory that opens it. This app ships one
// project type (the TODL package); later modules register more types here.
export class TodlProjectFactoryRegistry implements IProjectFactoryRegistry {
  private readonly todlPackage = new TodlPackageProjectFactory();

  public factoryFor(typeId: string): IProjectFactory | undefined {
    return typeId === TODL_PACKAGE_TYPE ? this.todlPackage : undefined;
  }
}

// Registers the APP-SPECIFIC host seams the SolutionManagerService resolves by
// key — the ones only this app knows: which project types it opens
// (TodlProjectFactoryRegistry) and how it resolves Domain packages
// (IpcPackageSource, over the main-side registry bridge). The GENERIC seams — the
// user-decision prompt service and the storage-provider registry — are supplied
// by the SolutionServicesStudio module (plexus-core); the engine services
// themselves (SolutionManagerService + settings) come from SolutionServicesEngine
// (a plain IModule in @pragmatic-tech-ai/todl, added imperatively from main.ts).
// This installs only the app's own host knowledge at the composition root.
export class SolutionServicesRegistration {
  public static Register(services: IServiceContainer): void {
    services.register(
      SolutionManagerService.ProjectFactoryRegistryKey,
      (): IProjectFactoryRegistry => new TodlProjectFactoryRegistry(),
    );
    services.register(
      SolutionManagerService.PackageSourceKey,
      (p) => new IpcPackageSource(p.getRequired(RegistryClient)),
    );
  }
}
