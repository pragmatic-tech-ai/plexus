// graph-viewer.module.mu — registers GraphViewerService, which opens a read-only
// Board view of a deployed graph (read live via Cypher, projected, auto-laid-out).
// No nav capability and no project type — a pure service contribution the Tenant
// Explorer invokes when a graph node is selected. The canvas + node templates live
// in GraphViewerResources (merged app-global by app.mu).

import GraphViewerService from "./services/graph-viewer-service.js"

shell module GraphViewerModule [ Name = "Graph Viewer" ] {
    .services: {
        GraphViewerService
    }
}
