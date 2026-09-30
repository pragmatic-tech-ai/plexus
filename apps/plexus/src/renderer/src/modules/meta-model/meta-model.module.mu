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
// `.services:` registers the panel service + the `.todl` doc factory + the package
// store seam; the Capability names the panel service via `ServiceKey`. The "meta-model"
// project TYPE (MetaModelProjectFactory) now lives in TODL's project-system module
// (TodlProjectSystemModule) — this module keeps only its shell contributions.

import MetaModelsService from "./services/meta-models-service.js"
import TodlDocumentFactory from "./services/todl-document-factory.js"
import ConnectionAwarePlexusPackageStore from "../../services/projects/storage-service-backends.js"

shell module MetaModelModule [ Name = "Meta-model" ] {
    .services: {
        MetaModelsService
        TodlDocumentFactory
        // The producer seam the relocated (todl) meta-model + library factories
        // resolve at publish time — the single StorageService-backed package store,
        // registered here (app-global DI) under todl's PackageStoreKey. The
        // connection-aware wrapper reads locally first and, on a base-resolution miss,
        // fetches the ref from the consuming project's effective connection (P5b).
        // Presentation baking is TODL's own: TodlProjectSystemModule registers the
        // default baker under PresentationBakerKey and the composed build resolves it.
        ConnectionAwarePlexusPackageStore
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
