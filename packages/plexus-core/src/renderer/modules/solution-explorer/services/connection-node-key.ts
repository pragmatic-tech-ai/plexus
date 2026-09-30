// Provider-scoped presentation families for the Connections subtree — below the
// ConnectionsProvider boundary, so never contributor-matched (mirrors ReferenceNodeKey).
// The global branch root uses the framework's NodeKey.Connections; these key the connection
// leaves and the per-project active-connection row.
export class ConnectionNodeKey
{
    public static readonly Leaf = 'connection-leaf'
    public static readonly Active = 'connection-active'
}
