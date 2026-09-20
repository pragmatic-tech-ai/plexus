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
// `.services:` registers the panel service + the `.todl` doc factory + the producer
// seams; the Capability names the panel service via `ServiceKey`. The "meta-model"
// project TYPE (MetaModelProjectFactory) now lives in the solution engine module
// (SolutionServicesEngine) — this module keeps only its shell contributions.

import MetaModelsService from "./services/meta-models-service.js"
import TodlDocumentFactory from "./services/todl-document-factory.js"
import MuralPresentationBaker from "../../services/projects/mural-presentation-baker.js"
import StorageServiceBackends from "../../services/projects/storage-service-backends.js"

shell module MetaModelModule [ Name = "Meta-model" ] {
    .services: {
        MetaModelsService
        TodlDocumentFactory
        // The producer seams the relocated (todl) meta-model + library factories
        // resolve at publish time — the mural-compiler presentation baker and the
        // StorageService-backed producer backends. Registered here (app-global DI)
        // so both producer factories find them under todl's ServiceKeys.
        MuralPresentationBaker
        StorageServiceBackends
    }

    Capability [ Name = "Meta-models", Icon = @MetaModels, ServiceKey = MetaModelsService ]

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
