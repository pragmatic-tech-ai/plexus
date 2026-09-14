// architecture-projects.module.mu - the Architecture Projects module.
//
// A ShellModule with NO nav Capability (like code-editor/problems/agent-chat):
// it carries only the BACKEND for architecture projects — the `architecture`
// project type (ArchitectureProjectFactory) — with no left-panel entry. Its
// `.todl` files are the architecture model; `.diagram` files inside are edited
// by the diagram module's generic DiagramDocumentFactory (resolved by extension),
// standalone today and model-bound once the ArchitectureModelService lands.

import ArchitectureProjectFactory from "./services/architecture-project-factory.js"
import ModelPatchApplier from "./services/model-patch-applier.js"

module ArchitectureProjectsModule [ Name = "Architecture Projects" ] {
    .services: {
        ArchitectureProjectFactory
        // Applies agent-proposed model patches to this project's ArchModel (Skills #4).
        ModelPatchApplier
    }

    // The 'architecture' project type — this module owns it (editors own files,
    // modules own project types). ArchitectureProjectFactory owns the project
    // lifecycle; the .diagram files inside are edited by the diagram module's
    // DiagramDocumentFactory, resolved by extension.
    .projectFactories: {
        ProjectFactoryDefinition
            [ Type    = "architecture",
              Title   = "Architecture Project",
              Factory = ArchitectureProjectFactory ]
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
