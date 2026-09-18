// library.module.mu — the Library module.
//
// A ShellModule that contributes the "library" PROJECT TYPE (not a nav
// capability). A user creates a Library project from New Project against a chosen
// meta-model, authors technology-library (taxonomy) .todl definitions inside it
// (validated live by the shared base-aware TodlValidationService against the
// bound meta-model), and publishes the compiled model + sources into the
// libraries storage backend. The "library" project TYPE (LibraryProjectFactory)
// now lives in the basic ProjectFactoriesModule; this module keeps the Libraries
// panel service + its rail Capability + the library registry.
//
// The `.todl` FILE editor is contributed by the meta-model module's `.documents:`
// entry (resolved by extension for any project).

import LibraryRegistry from "./services/library-registry.js"
import LibrariesPanelService from "./services/libraries-panel-service.js"

shell module LibraryModule [ Name = "Library" ] {
    .services: {
        LibraryRegistry
        LibrariesPanelService
    }

    Capability [ Name = "Libraries", Icon = @Libraries, ServiceKey = LibrariesPanelService ]
}
