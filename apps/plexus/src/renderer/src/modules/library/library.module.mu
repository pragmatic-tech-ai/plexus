// library.module.mu — the Library module.
//
// A ShellModule that contributes the "library" PROJECT TYPE (not a nav
// capability). A user creates a Library project from New Project against a chosen
// meta-model, authors technology-library (taxonomy) .todl definitions inside it
// (validated live by the shared base-aware TodlValidationService against the
// bound meta-model), and publishes the compiled model + sources into the
// libraries storage backend. A pure contributor — a service + a project factory,
// no Capability — so it declares no rail entry; the project type is reached via
// New Project.
//
// The `.todl` FILE editor is contributed by the meta-model module's `.documents:`
// entry (resolved by extension for any project), so this module only registers
// the project factory + its `.projectFactories:` routing.

import LibraryProjectFactory from "./services/library-project-factory.js"
import LibraryRegistry from "./services/library-registry.js"
import LibrariesPanelService from "./services/libraries-panel-service.js"

module LibraryModule [ Name = "Library" ] {
    .services: {
        LibraryProjectFactory
        LibraryRegistry
        LibrariesPanelService
    }

    Capability [ Name = "Libraries", Icon = @Libraries, ServiceKey = LibrariesPanelService ]

    .projectFactories: {
        ProjectFactoryDefinition
            [ Type        = "library",
              Title       = "Library Project",
              Description = "Author a technology library (taxonomy) against a meta-model.",
              Factory     = LibraryProjectFactory ]
    }
}
