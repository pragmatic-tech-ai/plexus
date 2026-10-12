import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { NodeVisual } from '@pragmatic-tech-ai/mural/framework/diagram/serialization/node-visual-store.js'
import type { ArchModel } from './arch-model.js'
import { ARCH_CONNECTOR_VISUALS_KEY } from './arch-diagram-connector-visuals-store.js'

// Upgrades a `.diagram` authored before model instance ids were namespace-qualified.
//
// Old diagrams stored each arch node by its BARE declaration name (`teams`,
// `component2`) or a partially-qualified library ref (`evelyn_actors.evelyn_business_user`).
// The loader now qualifies every instance id (`ai_assistant_m365.models.teams`) and
// `Repository.resolve`/`has` are exact lookups, so the binding's rescan can no longer
// match a bare node id to its entity — every arch node falls through unbound and renders
// blank. This migration rewrites the three places a `.diagram` encodes a node id —
// the node's own `Id`, its geometry entry in the visual store (keyed by id, incl. a
// container `parentId`), and the `arch.connectorVisuals` edge keys (`from|token|to`) —
// to the qualified ids the current model produces. Idempotent: an already-qualified id
// resolves against the model and is skipped, so a migrated diagram is left untouched.
export class ArchDiagramIdMigration
{
    private static readonly EdgeKeySeparator = '|'

    // The qualified node id an old (bare / partially-qualified) diagram id maps to,
    // or undefined when it is already current or cannot be resolved unambiguously.
    // `existingIds` is every node id the model knows (own instances ∪ merged bases).
    //   1. already a real id        → undefined (leave it; also the idempotency guard)
    //   2. an own instance          → `<namespace>.<oldId>` (checked first, so a bare
    //                                  name that also names a library term binds to the
    //                                  project's own instance, never the library one)
    //   3. a library / meta term    → the unique id ending in `.<oldId>`
    //   4. ambiguous or unknown      → undefined (left as a freeform node)
    public static QualifiedIdFor(oldId: string, existingIds: ReadonlySet<string>, namespace: string): string | undefined
    {
        if (existingIds.has(oldId))
        {
            return undefined
        }
        const own = `${namespace}.${oldId}`
        if (existingIds.has(own))
        {
            return own
        }
        const suffix = `.${oldId}`
        let match: string | undefined
        for (const id of existingIds)
        {
            if (id.endsWith(suffix))
            {
                if (match !== undefined)
                {
                    return undefined // ambiguous — more than one node ends in `.oldId`
                }
                match = id
            }
        }
        return match
    }

    // Rewrite every stale id in `doc` to the qualified id the model produces, in place.
    // Returns true if anything changed (so the caller knows to persist). Safe to call on
    // any diagram: a diagram with no stale ids is untouched and returns false.
    public static Migrate(doc: DiagramDocument, model: ArchModel): boolean
    {
        const existingIds = new Set<string>(model.repository().allNodes().map((n) => n.id))
        const namespace = model.namespace
        const renames = new Map<string, string>()

        // Pass 1: rename each stale node and move its geometry entry to the new id.
        for (const node of doc.Nodes.ToArray())
        {
            const id = (node as { Id?: string }).Id
            if (id === undefined)
            {
                continue
            }
            const qualified = ArchDiagramIdMigration.QualifiedIdFor(id, existingIds, namespace)
            if (qualified === undefined)
            {
                continue
            }
            const visual = doc.GetNodeVisual(id)
            ;(node as { Id?: string }).Id = qualified
            if (visual !== undefined)
            {
                doc.SetNodeVisual(qualified, visual)
            }
            renames.set(id, qualified)
        }

        if (renames.size === 0)
        {
            return false
        }

        // Pass 2: remap container parentId references that point at a renamed node.
        for (const node of doc.Nodes.ToArray())
        {
            const id = (node as { Id?: string }).Id
            if (id === undefined)
            {
                continue
            }
            const visual = doc.GetNodeVisual(id)
            const parentId = visual?.parentId
            if (visual !== undefined && parentId !== undefined && renames.has(parentId))
            {
                const remapped: NodeVisual = { ...visual, parentId: renames.get(parentId) }
                doc.SetNodeVisual(id, remapped)
            }
        }

        // Pass 3: remap the `from|token|to` endpoints of every connectorVisuals key.
        ArchDiagramIdMigration.remapConnectorVisualKeys(doc, renames)
        return true
    }

    // Rewrite the endpoint ids in each `arch.connectorVisuals` key (`from|token|to`,
    // where token may itself contain the separator-free scenario/entity marker). Only
    // the first and last `|`-delimited segments are node ids; the middle is preserved
    // verbatim. Keys whose endpoints were not renamed are left as-is.
    private static remapConnectorVisualKeys(doc: DiagramDocument, renames: ReadonlyMap<string, string>): void
    {
        const raw = doc.Metadata[ARCH_CONNECTOR_VISUALS_KEY]
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        {
            return
        }
        const before = raw as Record<string, unknown>
        const after: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(before))
        {
            after[ArchDiagramIdMigration.remapEdgeKey(key, renames)] = value
        }
        doc.Metadata = { ...doc.Metadata, [ARCH_CONNECTOR_VISUALS_KEY]: after }
    }

    private static remapEdgeKey(key: string, renames: ReadonlyMap<string, string>): string
    {
        const sep = ArchDiagramIdMigration.EdgeKeySeparator
        const firstPipe = key.indexOf(sep)
        const lastPipe = key.lastIndexOf(sep)
        if (firstPipe < 0 || lastPipe === firstPipe)
        {
            return key // not a from|token|to key — leave untouched
        }
        const from = key.slice(0, firstPipe)
        const middle = key.slice(firstPipe, lastPipe + 1) // keeps the surrounding separators
        const to = key.slice(lastPipe + 1)
        return `${renames.get(from) ?? from}${middle}${renames.get(to) ?? to}`
    }
}
