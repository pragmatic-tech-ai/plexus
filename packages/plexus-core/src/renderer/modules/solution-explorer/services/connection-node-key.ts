// Provider-scoped presentation families for the Connections subtree — below the
// ConnectionsProvider boundary, so never contributor-matched (mirrors ReferenceNodeKey).
// The global branch root uses the framework's NodeKey.Connections; these key the connection
// leaves and the per-project active-connection row.
export class ConnectionNodeKey
{
    public static readonly Leaf = 'connection-leaf'
    // GitHub-provider leaves carry a distinct icon-key prefix (a superstring of Leaf) so the
    // glyph mapping paints the GitHub mark instead of the generic file glyph; health still rides
    // the severity decoration, not the icon.
    public static readonly GithubLeaf = 'connection-leaf-github'
    public static readonly Active = 'connection-active'
}
