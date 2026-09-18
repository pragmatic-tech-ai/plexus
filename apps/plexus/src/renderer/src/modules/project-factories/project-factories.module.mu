// project-factories.module.mu — the app's project TYPES, as a basic engine module.
//
// A plain `module` (no capabilities / resources → a headless Module): it registers
// the three project-factory services (meta-model / library / architecture) and the
// AppProjectFactoryRegistry that indexes them, under the engine's
// ProjectFactoryRegistryKey. Project types are an ENGINE concern (opening/creating
// project data), so they live here rather than scattered across the presentation
// (shell) modules — those keep only their panels / documents / capabilities.
//
// The SolutionManagerService (opening members) and the ProjectExplorer (New-Project
// gallery + open routing) both resolve this one registry.

import MetaModelProjectFactory from "@pragmatic-tech-ai/todl"
import LibraryProjectFactory from "@pragmatic-tech-ai/todl"
import ArchitectureProjectFactory from "@pragmatic-tech-ai/todl"
import ProjectFactoryRegistryKey from "@pragmatic-tech-ai/todl"
import AppProjectFactoryRegistry from "./app-project-factory-registry.js"

module ProjectFactoriesModule {
    .services: {
        MetaModelProjectFactory
        LibraryProjectFactory
        ArchitectureProjectFactory
        AppProjectFactoryRegistry -> ProjectFactoryRegistryKey
    }
}
