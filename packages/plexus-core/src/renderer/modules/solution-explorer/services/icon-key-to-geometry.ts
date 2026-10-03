import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { iconKeyForKind } from '../../../projects/project-node-icon.js'
import { ReferenceNodeKey } from './reference-node-key.js'
import { ConnectionNodeKey } from './connection-node-key.js'

// The hierarchy row's leading glyph key for a HierarchyNode.IconKey. Content-node keys
// (folder/file/diagram/todl) reuse the existing project-node glyph mapping; the coarse
// project family and the solution root get the folder glyph as a P2 placeholder (a real
// project/solution icon is a P4/registry concern). One home for the mapping, referenced
// by the converter below and unit-tested directly (no Application needed).
export class IconKeyGlyphs
{
    private static readonly FolderGlyph = 'Folder'
    // Reference/connection leaves reuse the file glyph as a placeholder — a dedicated
    // glyph (and the resolution/health split) is a theme concern.
    private static readonly ReferenceLeafGlyph = 'File'
    private static readonly ConnectionLeafGlyph = 'File'

    public static For(iconKey: string): string
    {
        // Reference leaves carry a resolution suffix (…-live / -published / -unresolved) and
        // connection leaves a health suffix (…-default / -ready / -nocreds / -unreachable).
        // Guard the type: the row template binds HierarchyItem.IconKey, which is undefined
        // for some rows — a bare .startsWith there would throw and crash every row's render.
        if (typeof iconKey === 'string' && iconKey.startsWith(ReferenceNodeKey.Leaf)) return IconKeyGlyphs.ReferenceLeafGlyph
        if (typeof iconKey === 'string' && iconKey.startsWith(ConnectionNodeKey.Leaf)) return IconKeyGlyphs.ConnectionLeafGlyph
        switch (iconKey)
        {
            case NodeKey.Solution:       return IconKeyGlyphs.FolderGlyph
            case NodeKey.Project:        return IconKeyGlyphs.FolderGlyph
            case NodeKey.References:      return IconKeyGlyphs.FolderGlyph
            case ReferenceNodeKey.Group:  return IconKeyGlyphs.FolderGlyph
            case NodeKey.Connections:     return IconKeyGlyphs.FolderGlyph
            case ConnectionNodeKey.Active: return IconKeyGlyphs.FolderGlyph
            default:                     return iconKeyForKind(iconKey as ProjectNodeKind)
        }
    }
}

// Resolves a hierarchy row's IconKey to its themed geometry, mirroring KindToGeometry:
// a one-shot resolve out of the mounted resource dictionary (undefined until it mounts,
// in which case the Shape paints nothing).
export const IconKeyToGeometry: ValueConverter = {
    convert: (iconKey: unknown) => Application.current?.Resources.Resolve(IconKeyGlyphs.For(iconKey as string)),
}
