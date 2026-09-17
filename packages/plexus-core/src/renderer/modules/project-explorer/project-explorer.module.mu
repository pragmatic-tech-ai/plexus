// project-explorer.module.mu â€” the Project Explorer module.
//
// A ShellModule: a capability provider added to the shell via a `.modules:`
// block on the Application. Its capability is one root-nav entry (Name + Icon)
// whose content is service-backed â€” the `.services:` block registers the
// service, the Capability names it via `ServiceKey`, and a shared
// `DataTemplate [DataType = PlexusPanelService]` (in panels.resources.mu) renders it in the
// left panel. See services/panels/panel-services.ts and diagram.module.mu.

import ProjectExplorerService from "./services/project-explorer-service.js"

module ProjectExplorerModule [ Name = "Project Explorer" ] {
    .services: {
        ProjectExplorerService
    }

    Capability [ Name = "Project Explorer", Icon = @ProjectExplorer, ServiceKey = ProjectExplorerService ]
}
