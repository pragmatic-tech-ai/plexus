import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { iconKeyForKind } from '../../../projects/project-node-icon.js'
import { ReferenceNodeKey } from './reference-node-key.js'
import { ConnectionNodeKey } from './connection-node-key.js'

// The IconKey a project-content folder carries when it is the build-output folder (a
// root folder named "build"): ProjectHierarchyProvider stamps it, IconKeyGlyphs.For maps
// it to the Build glyph. One home for the key both sides share.
export const BuildFolderIconKey = 'build-folder'

// The hierarchy row's leading glyph key for a HierarchyNode.IconKey. Content-node keys
// (folder/file/diagram/todl) reuse the existing project-node glyph mapping; the coarse
// project family and the solution root get the folder glyph as a P2 placeholder (a real
// project/solution icon is a P4/registry concern). One home for the mapping, referenced
// by the converter below and unit-tested directly (no Application needed).
export class IconKeyGlyphs
{
    private static readonly FolderGlyph = 'Folder'
    // The build-output folder's glyph (a root folder named "build").
    private static readonly BuildGlyph = 'Build'
    // The expanded-state glyph for any node drawn as a folder — the row template swaps
    // to this when the row is expanded (see ForExpanded).
    private static readonly FolderOpenGlyph = 'FolderOpen'
    // The Connections branch node's own glyph (not a folder — so it does NOT open).
    private static readonly ConnectionsGlyph = 'ConnectionsFolder'
    // Reference/connection leaves reuse the file glyph as a placeholder — a dedicated
    // glyph (and the resolution/health split) is a theme concern.
    private static readonly ReferenceLeafGlyph = 'File'
    private static readonly ConnectionLeafGlyph = 'File'
    private static readonly GithubGlyph = 'Github'

    public static For(iconKey: string): string
    {
        // Reference leaves carry a resolution suffix (…-live / -published / -unresolved) and
        // connection leaves a health suffix (…-default / -ready / -nocreds / -unreachable).
        // Guard the type: the row template binds HierarchyItem.IconKey, which is undefined
        // for some rows — a bare .startsWith there would throw and crash every row's render.
        if (typeof iconKey === 'string' && iconKey.startsWith(ReferenceNodeKey.Leaf)) return IconKeyGlyphs.ReferenceLeafGlyph
        // GithubLeaf is a superstring of Leaf — check it first so the GitHub mark wins.
        if (typeof iconKey === 'string' && iconKey.startsWith(ConnectionNodeKey.GithubLeaf)) return IconKeyGlyphs.GithubGlyph
        if (typeof iconKey === 'string' && iconKey.startsWith(ConnectionNodeKey.Leaf)) return IconKeyGlyphs.ConnectionLeafGlyph
        switch (iconKey)
        {
            case BuildFolderIconKey:     return IconKeyGlyphs.BuildGlyph
            case NodeKey.Solution:       return IconKeyGlyphs.FolderGlyph
            case NodeKey.Project:        return IconKeyGlyphs.FolderGlyph
            case NodeKey.References:      return IconKeyGlyphs.FolderGlyph
            case ReferenceNodeKey.Group:  return IconKeyGlyphs.FolderGlyph
            case NodeKey.Connections:     return IconKeyGlyphs.ConnectionsGlyph
            case ConnectionNodeKey.Active: return IconKeyGlyphs.FolderGlyph
            default:                     return iconKeyForKind(iconKey as ProjectNodeKind)
        }
    }

    // The glyph for an EXPANDED row: a node drawn as a folder shows the open-folder
    // glyph; every other node (connections, leaves, files, diagrams) keeps its glyph,
    // so a non-folder icon never vanishes or changes on expand.
    public static ForExpanded(iconKey: string): string
    {
        const glyph = IconKeyGlyphs.For(iconKey)
        return glyph === IconKeyGlyphs.FolderGlyph ? IconKeyGlyphs.FolderOpenGlyph : glyph
    }

    // Resolves an IconKey to its themed geometry out of the mounted resource dictionary
    // (undefined until it mounts, in which case the Shape paints nothing). Memoised by
    // glyph key — the solution tree can be many rows and the dictionary walk is a known
    // navigation hotspot; the resolved geometry is stable, so it is cached once per glyph.
    private static readonly GeometryByGlyph = new Map<string, unknown>()

    public static GeometryFor(iconKey: string): unknown
    {
        return IconKeyGlyphs.resolve(IconKeyGlyphs.For(iconKey))
    }

    public static GeometryForExpanded(iconKey: string): unknown
    {
        return IconKeyGlyphs.resolve(IconKeyGlyphs.ForExpanded(iconKey))
    }

    private static resolve(glyph: string): unknown
    {
        const cached = IconKeyGlyphs.GeometryByGlyph.get(glyph)
        if (cached !== undefined) return cached
        const geom = Application.current?.Resources.Resolve(glyph)
        if (geom !== undefined) IconKeyGlyphs.GeometryByGlyph.set(glyph, geom)
        return geom
    }
}

export const IconKeyToGeometry: ValueConverter = {
    convert: (iconKey: unknown) => IconKeyGlyphs.GeometryFor(iconKey as string),
}

// The expanded-row variant the template binds on its second (open-folder) icon shape;
// only one of the two icon shapes is visible at a time (toggled by the IsExpanded trigger).
export const IconKeyToExpandedGeometry: ValueConverter = {
    convert: (iconKey: unknown) => IconKeyGlyphs.GeometryForExpanded(iconKey as string),
}
