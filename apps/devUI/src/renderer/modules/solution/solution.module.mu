// Solution module — a logical grouping of projects + cross-project settings as a
// rail capability. The domain services (SolutionManagerService, its settings
// registry) live in @pragmatic-tech-ai/todl; the app supplies the storage
// SolutionExplorerService presentation service (which projects the active solution
// into the side-panel view via DataTemplate[SolutionExplorerService]). The storage
// backend (StorageService) is provided by the shared Storage module, composed at
// the app root. The manager's host services are registered at the composition root
// by SolutionServicesRegistration.
import SolutionManagerService from "@pragmatic-tech-ai/todl"
import SolutionSettingsRegistry from "@pragmatic-tech-ai/todl"
import SolutionExplorerService from "./solution-explorer-service.ts"

module SolutionModule [ Name = "Solutions" ] {
    .services: {
        SolutionManagerService
        SolutionSettingsRegistry
        SolutionExplorerService
    }

    Capability [
        Name       = "Solutions",
        Icon       = @Solutions,
        ServiceKey = SolutionExplorerService
    ]
}
