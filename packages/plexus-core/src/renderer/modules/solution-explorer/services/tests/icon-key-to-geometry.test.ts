import { describe, it, expect } from 'vitest'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ContentNodeKey } from '@pragmatic-tech-ai/todl'
import { glyphKeyForIconKey } from '../icon-key-to-geometry.js'

describe('glyphKeyForIconKey', () =>
{
    it('maps every content key + member + solution to a non-empty glyph key', () =>
    {
        for (const key of [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project, NodeKey.Solution])
        {
            expect(glyphKeyForIconKey(key).length).toBeGreaterThan(0)
        }
    })

    it('folder and diagram map to distinct glyphs', () =>
    {
        expect(glyphKeyForIconKey(ContentNodeKey.Folder)).not.toEqual(glyphKeyForIconKey(ContentNodeKey.Diagram))
    })

    it('a todl file gets its own glyph, distinct from a plain file', () =>
    {
        expect(glyphKeyForIconKey(ContentNodeKey.Todl)).not.toEqual(glyphKeyForIconKey(ContentNodeKey.File))
    })
})
