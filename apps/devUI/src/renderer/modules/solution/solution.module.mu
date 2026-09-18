// Solution module — a logical grouping of projects + cross-project settings as a
// rail capability. This module contributes only the app-side PRESENTATION service
// (SolutionExplorerService), which projects the active solution into the side
// panel via DataTemplate[SolutionExplorerService].
//
// The engine services (SolutionManagerService + its settings registry) are
// registered by SolutionServicesEngine — a plain IModule in @pragmatic-tech-ai/todl,
// added imperatively from main.ts. The generic host seams (prompt service, storage
// registry) come from the SolutionServicesStudio module (plexus-core); the
// app-specific seams (package source, project-factory registry) from
// SolutionServicesRegistration. StorageService is provided by the shared Storage
// module.
import SolutionExplorerService from "./solution-explorer-service.ts"

shell module SolutionModule [ Name = "Solutions" ] {
    .services: {
        SolutionExplorerService
    }

    Capability [
        Name       = "Solutions",
        Icon       = @Solutions,
        ServiceKey = SolutionExplorerService
    ]
}
