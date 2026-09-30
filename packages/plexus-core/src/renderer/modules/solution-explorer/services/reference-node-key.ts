// Provider-scoped presentation families for the References subtree — below the
// ReferencesProvider boundary, so never contributor-matched (mirrors TODL's
// ContentNodeKey). The branch root itself uses the framework's NodeKey.References; these
// key the group headers and the declared-reference leaves the provider mints.
export class ReferenceNodeKey
{
    public static readonly Group = 'reference-group'
    public static readonly Leaf = 'reference-leaf'
}
