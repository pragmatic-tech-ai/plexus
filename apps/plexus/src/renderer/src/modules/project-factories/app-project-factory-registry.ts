import { type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import {
  ProjectFactoryRegistry,
  MetaModelProjectFactory,
  LibraryProjectFactory,
  ArchitectureProjectFactory,
} from "@pragmatic-tech-ai/todl";

// This app's project-factory registry: the three project types Plexus installs
// (meta-model / library / architecture), resolved from the container and handed to
// the engine ProjectFactoryRegistry, which indexes them by typeId. Registered under
// ProjectFactoryRegistryKey by the ProjectFactoriesModule (a basic engine module),
// it supersedes mural's retired shell-side ProjectFactoryRegistry — the
// ProjectExplorer's New-Project gallery (All) and open routing (factoryFor) resolve
// this.
//
// The factories are resolved by their static `.Key`, not the bare class: the
// container does no class→Key normalization on get(), and each factory registers
// under `tokenFor(Class)` = its `.Key`.
export class AppProjectFactoryRegistry extends ProjectFactoryRegistry {
  constructor(provider: IServiceProvider) {
    super([
      provider.getRequired(MetaModelProjectFactory.Key),
      provider.getRequired(LibraryProjectFactory.Key),
      provider.getRequired(ArchitectureProjectFactory.Key),
    ]);
  }
}
