// meta-model-node-icon.ts — the Meta-models tree's per-kind leading glyph.
//
// The tree renders declaratively (a HierarchicalDataTemplate over
// MetaModelTreeNode.Children — see meta-model.resources.mu), so the data-driven
// icon flows through a value converter (`$Kind << MetaModelKindToGeometry`).
// Distinct from the project explorer's KindToGeometry (different key set).
import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'

import { MetaModelNodeKind } from './meta-model-tree-node.js'

// The leading glyph resource key for a node kind (all registered in
// plexus-icons.mu). An unrecognised kind falls back to the generic File glyph.
export function iconKeyForNodeKind(kind: MetaModelNodeKind): string
{
    switch (kind)
    {
        case MetaModelNodeKind.Model:   return 'MetaModels'
        case MetaModelNodeKind.Version: return 'Todl'
        case MetaModelNodeKind.Group:   return 'Folder'
        default:                        return 'File'
    }
}

// Resolves a node's Kind to its themed leading geometry. Geometries are
// theme-agnostic (registered once in PlexusIcons), so a one-shot resolve is
// stable across scheme switches — the Shape's Fill carries the reactive brush.
export const MetaModelKindToGeometry: ValueConverter = {
    convert: (kind: unknown) =>
        Application.current?.Resources.Resolve(iconKeyForNodeKind(kind as MetaModelNodeKind)),
}
