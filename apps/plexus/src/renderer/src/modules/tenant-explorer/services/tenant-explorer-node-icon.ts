// tenant-explorer-node-icon.ts — the Tenant Explorer tree's per-kind leading glyph.
//
// The tree renders declaratively (a HierarchicalDataTemplate over
// TenantExplorerNode.Children — see tenant-explorer.resources.mu), so the data-driven
// icon flows through a value converter (`$Kind << TenantExplorerKindToGeometry`).
import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'

import { TenantExplorerNodeKind } from './tenant-explorer-node.js'

// The leading glyph resource key for a node kind (all registered in plexus-icons.mu).
// An unrecognised kind falls back to the generic File glyph.
export function iconKeyForKind(kind: TenantExplorerNodeKind): string
{
    switch (kind)
    {
        case TenantExplorerNodeKind.Tenant:      return 'Folder'
        case TenantExplorerNodeKind.Environment: return 'ServerEnvironment'
        case TenantExplorerNodeKind.Application: return 'AppGeneric'
        case TenantExplorerNodeKind.Graph:       return 'GraphNode'
        case TenantExplorerNodeKind.Message:     return 'File'
        default:                                 return 'File'
    }
}

// Resolves a node's Kind to its themed leading geometry (theme-agnostic, so a
// one-shot resolve is stable across scheme switches).
export const TenantExplorerKindToGeometry: ValueConverter = {
    convert: (kind: unknown) =>
        Application.current?.Resources.Resolve(iconKeyForKind(kind as TenantExplorerNodeKind)),
}
