// app-ui-gen.module.mu — the "Generate UI" project command.
//
// Adds "Generate UI…" to a project (member) row: asks for a concept, runs TODL's
// ConceptUiGenerationService (list view + form + CRUD view-model) against the project, and
// reports the written / skipped files. A pure contributor; no nav Capability.

import GenerateUiContributor from "./services/generate-ui-contributor.js"

shell module AppUiGenModule [ Name = "App UI Generation" ] {
    .services: {
        GenerateUiContributor
    }

    Hierarchy {
        Contributor [ Under = "project", Use = GenerateUiContributor, Order = 110 ] {
            CommandDefinition
                [ Id      = "appui.generate",
                  Title   = "Generate UI…",
                  Context = "project" ]
        }
    }
}
