// meta-model.module.mu — the Meta-model module.
//
// A ShellModule that contributes both a "meta-models" NAV CAPABILITY and the
// "meta-model" PROJECT TYPE. The capability adds one root-nav entry whose
// left-panel content is served by MetaModelsService (via the shared
// `DataTemplate [DataType = PlexusPanelService]`). The project type lets a user
// create a Meta-model project from New Project, author .todl definitions inside
// it (validated live), and publish the compiled model + sources into the
// meta-models storage backend.
//
// Mirrors the diagram module's contribution shape (see diagram.module.mu):
// `.services:` registers the panel service + factory + doc factory, the
// Capability names the panel service via `ServiceKey`, and `.projectFactories:`
// routes a folder whose manifest type is "meta-model" to the factory via the
// ProjectFactoryRegistry.

import MetaModelsService from "./services/meta-models-service.js"
import MetaModelProjectFactory from "./services/meta-model-project-factory.js"
import TodlDocumentFactory from "./services/todl-document-factory.js"

module MetaModelModule [ Name = "Meta-model" ] {
    .services: {
        MetaModelsService
        MetaModelProjectFactory
        TodlDocumentFactory
    }

    Capability [ Name = "Meta-models", Icon = @MetaModels, ServiceKey = MetaModelsService ]

    .projectFactories: {
        ProjectFactoryDefinition
            [ Type        = "meta-model",
              Title       = "Meta-model Project",
              Description = "Author and validate TODL meta-model definitions.",
              Factory     = MetaModelProjectFactory ]
    }

    // The `.todl` editor — resolved by the ProjectExplorerService for open/save/
    // new of any `.todl` file (in any project). Factory is TodlDocumentFactory.
    .documents: {
        DocumentDefinition
            [ Type           = "todl",
              Title          = "TODL",
              Description    = "A TODL definition source file.",
              FileExtensions = [".todl"],
              Factory        = TodlDocumentFactory ]
    }
}
