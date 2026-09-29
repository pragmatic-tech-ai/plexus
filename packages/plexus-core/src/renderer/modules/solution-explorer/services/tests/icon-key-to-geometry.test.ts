import { describe, it, expect } from 'vitest'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ContentNodeKey } from '@pragmatic-tech-ai/todl'
import { IconKeyGlyphs } from '../icon-key-to-geometry.js'

describe('IconKeyGlyphs.For', () =>
{
    it('maps every content key + member + solution to a non-empty glyph key', () =>
    {
        for (const key of [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project, NodeKey.Solution])
        {
            expect(IconKeyGlyphs.For(key).length).toBeGreaterThan(0)
        }
    })

    it('folder and diagram map to distinct glyphs', () =>
    {
        expect(IconKeyGlyphs.For(ContentNodeKey.Folder)).not.toEqual(IconKeyGlyphs.For(ContentNodeKey.Diagram))
    })

    it('a todl file gets its own glyph, distinct from a plain file', () =>
    {
        expect(IconKeyGlyphs.For(ContentNodeKey.Todl)).not.toEqual(IconKeyGlyphs.For(ContentNodeKey.File))
    })
})
