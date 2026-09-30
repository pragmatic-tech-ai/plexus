// connections.module.mu — the app-side wiring for the P5b Connections feature.
//
// Registers the two app collaborators plexus-core's connection surface resolves through DI:
//   * ConnectionsClient — the renderer client over window.api.connections (ConnectionsClientKey),
//     which ProjectExplorerService's ConnectionEditingService consumes.
//   * ConnectionEditorLauncher — the New/Edit dialog launcher (ConnectionEditorLauncherKey) the
//     Solution Explorer's ConnectionActionsContributor calls.
// Composed before SolutionExplorerModule so both are available when the tree first builds. The
// editor dialog's view lives in connections.resources.mu (merged in app.mu).

import ConnectionsClient from "../../services/connections/connections-client.js"
import ConnectionEditorLauncher from "./connection-editor-launcher.js"

module ConnectionsModule [ Name = "Connections" ] {
    .services: {
        ConnectionsClient
        ConnectionEditorLauncher
    }
}
