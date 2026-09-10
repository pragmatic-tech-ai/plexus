import type { TodlDocument, JsonNode } from '@pragmatic-tech-ai/todl'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MetaModelTreeNode, MetaModelNodeKind, type EntityRef } from './meta-model-tree-node.js'
import { ontologyEntities, humanize, OntologyKind } from './presentation-generator.js'

// A term is a taxonomy's `Contains` target that is a class node.
const CONTAINS = 'Contains'

// The term nodes of a taxonomy: its `Contains` targets with `attrs.class === true`.
export function termsOf(doc: TodlDocument, taxonomyId: string): JsonNode[]
{
    const targets = new Set(
        doc.edges.filter((e) => e.kind === CONTAINS && e.from === taxonomyId).map((e) => e.to),
    )
    return doc.nodes.filter((n) => targets.has(n.id) && n.attrs['class'] === true)
}

// A published meta-model as plain data: its id and the versions found under it.
export interface PublishedModel { id: string; versions: string[] }

// A delete request from a tree row: a whole model (id only) or one version.
export interface DeleteTarget { id: string; version?: string }

// Scan the meta-models backend for published models. Layout on disk is
// `<id>/<modelVersion>/…`, so the root's directories are ids and each id's
// directories are versions. Sorted numeric-aware so 0.9.0 precedes 0.10.0.
export async function scanPublishedModels(storage: IStorage): Promise<PublishedModel[]>
{
    const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
    const ids = (await storage.List('')).filter((e) => e.IsDirectory).map((e) => e.Name).sort(byName)
    const out: PublishedModel[] = []
    for (const id of ids)
    {
        const versions = (await storage.List(id)).filter((e) => e.IsDirectory).map((e) => e.Name).sort(byName)
        out.push({ id, versions })
    }
    return out
}

// Build the catalog layer: one Model node per published id, each with lazy
// Version children whose entities load from model.json on first expand.
export async function buildCatalog(
    storage: IStorage,
    activate: (ref: EntityRef) => void,
    onDelete: (target: DeleteTarget) => void,
    markWiki?: (nodes: readonly MetaModelTreeNode[]) => void,
): Promise<MetaModelTreeNode[]>
{
    const published = await scanPublishedModels(storage)
    return published.map((p) =>
    {
        const model = MetaModelTreeNode.leaf(MetaModelNodeKind.Model, p.id)
        model.ModelId = p.id
        model.DeleteCommand = new RelayCommand(() => onDelete({ id: p.id }))
        for (const version of p.versions)
        {
            const vnode = MetaModelTreeNode.lazy(
                MetaModelNodeKind.Version, version,
                () => loadVersionEntities(storage, p.id, version, activate, markWiki),
            )
            vnode.ModelId = p.id
            vnode.ModelVersion = version
            vnode.DeleteCommand = new RelayCommand(() => onDelete({ id: p.id, version }))
            model.Children.Add(vnode)
        }
        return model
    })
}

// The ontology kinds presented as groups, in fixed display order.
const GROUPS: ReadonlyArray<{ kind: OntologyKind; label: string }> = [
    { kind: OntologyKind.Concept, label: 'Concepts' },
    { kind: OntologyKind.Relationship, label: 'Relationships' },
    { kind: OntologyKind.Taxonomy, label: 'Taxonomies' },
    { kind: OntologyKind.Viewpoint, label: 'Viewpoints' },
    { kind: OntologyKind.Primitive, label: 'Primitives' },
]

// Read a version's model.json and outline its ontology entities as Group → Entity
// nodes. Empty groups are omitted; a model with no entities yields a single
// "No entities" leaf; a missing/malformed model.json yields "Failed to load
// model.json".
export async function loadVersionEntities(
    storage: IStorage, id: string, version: string, activate: (ref: EntityRef) => void,
    markWiki?: (nodes: readonly MetaModelTreeNode[]) => void,
): Promise<MetaModelTreeNode[]>
{
    let doc: TodlDocument
    try { doc = JSON.parse(await storage.ReadText(`${id}/${version}/model.json`)) as TodlDocument }
    catch { return [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Failed to load model.json')] }

    const entities = ontologyEntities(doc)
    if (entities.length === 0) return [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'No entities')]

    // Every entity/term row built for this version, flagged for wiki after the
    // subtree is assembled (Concept = the ontology entity's local id).
    const entityNodes: MetaModelTreeNode[] = []
    const out: MetaModelTreeNode[] = []
    for (const g of GROUPS)
    {
        const inGroup = entities.filter((n) => n.typeOf === g.kind)
        if (inGroup.length === 0) continue
        const group = MetaModelTreeNode.leaf(MetaModelNodeKind.Group, g.label)
        for (const n of inGroup)
        {
            const ref: EntityRef = { modelId: id, version, id: n.id }
            const entityNode = MetaModelTreeNode.entity(entityLabel(n), ref, activate, n.id)
            entityNodes.push(entityNode)
            if (g.kind === OntologyKind.Taxonomy)
            {
                for (const term of termsOf(doc, n.id))
                {
                    const termRef: EntityRef = { modelId: id, version, id: term.id }
                    const termNode = MetaModelTreeNode.entity(entityLabel(term), termRef, activate, term.id)
                    entityNodes.push(termNode)
                    entityNode.Children.Add(termNode)
                }
            }
            group.Children.Add(entityNode)
        }
        out.push(group)
    }
    markWiki?.(entityNodes)
    return out
}

// An entity's row label: attrs.label when a string, else humanize(id).
function entityLabel(n: JsonNode): string
{
    return typeof n.attrs['label'] === 'string' ? String(n.attrs['label']) : humanize(n.id)
}
