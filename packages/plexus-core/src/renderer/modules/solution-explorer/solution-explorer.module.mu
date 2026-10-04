// solution-explorer.module.mu — the Solution Explorer module (P2).
//
// Replaces the Project Explorer panel Capability: this capability's ServiceKey is
// SolutionExplorerService, which owns the hierarchy tree. ProjectExplorerService
// survives as a lifecycle service (open/close/restore + OpenMemberFile) and is no
// longer a panel capability — see project-explorer.module.mu (its Capability is
// retired in Layer 3). Mirror of project-explorer.module.mu.

import SolutionExplorerService from "./services/solution-explorer-service.js"
import SolutionWorkspaceService from "./services/solution-workspace-service.js"

shell module SolutionExplorerModule [ Name = "Solution Explorer" ] {
    .services: {
        SolutionExplorerService
        // The new member-keyed IContentMutations implementer (over todl engine ops). Registered
        // so it is resolvable; the Solution Explorer is rewired onto it in a later PE-retirement
        // task — ProjectExplorerService stays the wired implementer for now.
        SolutionWorkspaceService
    }

    Capability [ Name = "Solution Explorer", Icon = @ProjectExplorer, ServiceKey = SolutionExplorerService ]
}
