// solution-explorer.module.mu — the Solution Explorer module (P2).
//
// Replaces the Project Explorer panel Capability: this capability's ServiceKey is
// SolutionExplorerService, which owns the hierarchy tree. ProjectExplorerService
// survives as a lifecycle service (open/close/restore + OpenMemberFile) and is no
// longer a panel capability — see project-explorer.module.mu (its Capability is
// retired in Layer 3). Mirror of project-explorer.module.mu.

import SolutionExplorerService from "./services/solution-explorer-service.js"
import SolutionWorkspaceService from "./services/solution-workspace-service.js"
import ProjectCommandsService from "./services/project-commands-service.js"
import LiveValidationSync from "./services/live-validation-sync.js"

shell module SolutionExplorerModule [ Name = "Solution Explorer" ] {
    .services: {
        SolutionExplorerService
        // The member-keyed IContentMutations implementer (over todl engine ops) + the
        // References / Connections views the explorer reads through.
        SolutionWorkspaceService
        // The Open / New project commands + New Project form the command bar binds to.
        ProjectCommandsService
        // Keeps live validation attached to the active solution's members (host calls Start()).
        LiveValidationSync
    }

    Capability [ Name = "Solution Explorer", Icon = @ProjectExplorer, ServiceKey = SolutionExplorerService ]
}
