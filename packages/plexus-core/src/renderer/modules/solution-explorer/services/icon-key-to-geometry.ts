import { Application, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { iconKeyForKind } from '../../../projects/project-node-icon.js'

// The hierarchy row's leading glyph key for a HierarchyNode.IconKey. Content-node keys
// (folder/file/diagram/todl) reuse the existing project-node glyph mapping; the coarse
// project family and the solution root get the folder glyph as a P2 placeholder (a real
// project/solution icon is a P4/registry concern). One home for the mapping, referenced
// by the converter below and unit-tested directly (no Application needed).
export class IconKeyGlyphs
{
    private static readonly FolderGlyph = 'Folder'

    public static For(iconKey: string): string
    {
        switch (iconKey)
        {
            case NodeKey.Solution: return IconKeyGlyphs.FolderGlyph
            case NodeKey.Project:  return IconKeyGlyphs.FolderGlyph
            default:               return iconKeyForKind(iconKey as ProjectNodeKind)
        }
    }
}

// Resolves a hierarchy row's IconKey to its themed geometry, mirroring KindToGeometry:
// a one-shot resolve out of the mounted resource dictionary (undefined until it mounts,
// in which case the Shape paints nothing).
export const IconKeyToGeometry: ValueConverter = {
    convert: (iconKey: unknown) => Application.current?.Resources.Resolve(IconKeyGlyphs.For(iconKey as string)),
}
