// solution-explorer.module.mu — the Solution Explorer module (P2).
//
// Replaces the retired Project Explorer panel Capability: this capability's
// ServiceKey is SolutionExplorerService, which owns the hierarchy tree.

import SolutionExplorerService from "./services/solution-explorer-service.js"
import SolutionWorkspaceService from "./services/solution-workspace-service.js"
import ProjectCommandsService from "./services/project-commands-service.js"
import SolutionCommandsService from "./services/solution-commands-service.js"
import LiveValidationSync from "./services/live-validation-sync.js"

shell module SolutionExplorerModule [ Name = "Solution Explorer" ] {
    .services: {
        SolutionExplorerService
        // The member-keyed IContentMutations implementer (over todl engine ops) + the
        // References / Connections views the explorer reads through.
        SolutionWorkspaceService
        // The Open / New project commands + New Project form the command bar binds to.
        ProjectCommandsService
        // The Save / Save As / Rename solution commands (menu, context menu, shortcuts).
        SolutionCommandsService
        // Keeps live validation attached to the active solution's members (host calls Start()).
        LiveValidationSync
    }

    Capability [ Name = "Solution Explorer", Icon = @ProjectExplorer, ServiceKey = SolutionExplorerService, Order = 10 ]
}
