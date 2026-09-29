// project-explorer.module.mu — the Project Explorer LIFECYCLE module (P2+).
//
// As of the Solution Hierarchy P2 migration this module registers
// ProjectExplorerService as a plain service only — it no longer contributes a
// panel Capability. The left-panel tree is now the Solution Explorer
// (solution-explorer.module.mu, whose Capability names SolutionExplorerService).
// ProjectExplorerService survives here because it still owns project lifecycle:
// open/close/restore session, the New/Open-project commands (delegated to by the
// Solution Explorer's command bar via pass-through getters), and OpenMemberFile
// (the Solution Explorer's open-on-activate entry point). A services-only module
// (`module`, not `shell module`), composed by adding it to an app's `.modules:`.

import ProjectExplorerService from "./services/project-explorer-service.js"

module ProjectExplorerModule {
    .services: {
        ProjectExplorerService
    }
}
