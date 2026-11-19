// board-export.module.mu — registers BoardExportService, which backs the
// board context-menu "Export" submenu (SVG / PPTX). No nav capability, no
// project type — a pure service contribution.
import BoardExportService from "./services/board-export-service.js"
import BoardHeadlessRenderer from "./services/board-headless-renderer.js"
import BoardTreeExport from "./services/board-tree-export.js"
import BoardExportActionContributor from "./services/board-export-action-contributor.js"

shell module BoardExportModule [ Name = "Board Export" ] {
    .services: {
        BoardExportService
        BoardHeadlessRenderer
        // The headless render+export pipeline, now registered under its own key so the
        // action contributor resolves it (was aliased to the retired BoardTreeExportKey).
        BoardTreeExport
        BoardExportActionContributor
    }

    // "Export ▸ SVG / PowerPoint" on a .board row — the BoardTreeExportKey
    // replacement on the B+C1 command seam. The two format rows are static, so they are
    // nested CommandDefinitions; BoardExportActionContributor resolves each Id to the
    // headless render + export pipeline and gates them (op present + .board) via CanExecute.
    Hierarchy {
        Contributor [ Under = "board", Use = BoardExportActionContributor, Order = 200 ] {
            CommandDefinition [ Id = "board.export", Title = "Export", Context = "board" ] {
                CommandDefinition [ Id = "board.export.svg", Title = "SVG", Context = "board" ]
                CommandDefinition [ Id = "board.export.pptx", Title = "PowerPoint (PPTX)", Context = "board" ]
            }
        }
    }
}
