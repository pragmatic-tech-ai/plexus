// architecture-projects.module.mu - the Architecture Projects module.
//
// A ShellModule with NO nav Capability (like code-editor/problems/agent-chat): it
// carries the model-patch applier + a diagram-toolbar command. The `architecture`
// project TYPE itself (ArchitectureProjectFactory) now lives in the basic
// ProjectFactoriesModule; this module keeps only its shell contributions. Its
// `.todl` files are the architecture model; `.diagram` files inside are edited by
// the diagram module's generic DiagramDocumentFactory (resolved by extension).

import ModelPatchApplier from "./services/model-patch-applier.js"

shell module ArchitectureProjectsModule [ Name = "Architecture Projects" ] {
    .services: {
        // Applies agent-proposed model patches to this project's ArchModel (Skills #4).
        ModelPatchApplier
    }

    // Diagram-toolbar command: edit the diagram's governing viewpoints. Rides the
    // DiagramEditingContext (shown while any diagram is active); its handler
    // (ArchEditViewpointsCommand, via the diagram command-extension seam) enables
    // it only for an arch-bound diagram and greys it out otherwise. Order 400
    // places it after the framework diagram commands.
    .commands: {
        CommandDefinition
            [ Id      = "arch.editViewpoints",
              Title   = "Edit Viewpoints",
              Icon    = @MetaModels,
              Context = DiagramEditingContext,
              Group   = "arch",
              Order   = 400 ]
    }
}
