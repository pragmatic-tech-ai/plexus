// diagram-export.module.mu — registers DiagramExportService, which backs the
// diagram context-menu "Export" submenu (SVG / PPTX). No nav capability, no
// project type — a pure service contribution.
import DiagramExportService from "./services/diagram-export-service.js"
import DiagramHeadlessRenderer from "./services/diagram-headless-renderer.js"

module DiagramExportModule [ Name = "Diagram Export" ] {
    .services: {
        DiagramExportService
        DiagramHeadlessRenderer
    }
}
