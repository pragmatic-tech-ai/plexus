// Connections module (ConnectionsManagerModule) — the registry connections
// manager as a rail capability. Its service (ConnectionsManagerVM, registered
// below) manages the list of package-registry connections (create/edit/remove,
// set token or point at an env var, test, choose the default) through the shared
// RegistryClient (connections:* bridge). The side panel renders it via
// DataTemplate[ConnectionsManagerVM] (connections.resources.mu) as a master/detail:
// the connection list on the left, the selected connection's editor on the right.
import ConnectionsManagerVM from "./connections-manager-vm.ts"

shell module ConnectionsManagerModule [ Name = "Connections" ] {
    .services: { ConnectionsManagerVM }

    Capability [
        Name       = "Connections",
        Icon       = @Connections,
        ServiceKey = ConnectionsManagerVM
    ]
}
