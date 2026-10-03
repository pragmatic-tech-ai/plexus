// diagram-export.module.mu — registers DiagramExportService, which backs the
// diagram context-menu "Export" submenu (SVG / PPTX). No nav capability, no
// project type — a pure service contribution.
import DiagramExportService from "./services/diagram-export-service.js"
import DiagramHeadlessRenderer from "./services/diagram-headless-renderer.js"
import DiagramTreeExport from "./services/diagram-tree-export.js"
import DiagramExportActionContributor from "./services/diagram-export-action-contributor.js"

shell module DiagramExportModule [ Name = "Diagram Export" ] {
    .services: {
        DiagramExportService
        DiagramHeadlessRenderer
        // The headless render+export pipeline, now registered under its own key so the
        // action contributor resolves it (was aliased to the retired DiagramTreeExportKey).
        DiagramTreeExport
        DiagramExportActionContributor
    }

    // "Export ▸ SVG / PowerPoint" on a .diagram row — the DiagramTreeExportKey
    // replacement on the B+C1 command seam. The two format rows are static, so they are
    // nested CommandDefinitions; DiagramExportActionContributor resolves each Id to the
    // headless render + export pipeline and gates them (op present + .diagram) via CanExecute.
    Hierarchy {
        Contributor [ Under = "diagram", Use = DiagramExportActionContributor, Order = 200 ] {
            CommandDefinition [ Id = "diagram.export", Title = "Export", Context = "diagram" ] {
                CommandDefinition [ Id = "diagram.export.svg", Title = "SVG", Context = "diagram" ]
                CommandDefinition [ Id = "diagram.export.pptx", Title = "PowerPoint (PPTX)", Context = "diagram" ]
            }
        }
    }
}
