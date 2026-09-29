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
    // replacement on the hierarchy action seam.
    .hierarchyActions: {
        HierarchyActionDefinition [ ActionKeys = ["diagram"], Contributor = DiagramExportActionContributor, Order = 200 ]
    }
}
