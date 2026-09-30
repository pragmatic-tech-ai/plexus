import { describe, it, expect } from 'vitest'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ContentNodeKey } from '@pragmatic-tech-ai/todl'
import { IconKeyGlyphs } from '../icon-key-to-geometry.js'
import { ReferenceNodeKey } from '../reference-node-key.js'

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

    it('the References branch keys map to the folder glyph', () =>
    {
        expect(IconKeyGlyphs.For(NodeKey.References)).toBe('Folder')
        expect(IconKeyGlyphs.For(ReferenceNodeKey.Group)).toBe('Folder')
    })

    it('every reference leaf resolution variant maps to a non-empty glyph', () =>
    {
        for (const suffix of ['-live', '-published', '-unresolved'])
        {
            expect(IconKeyGlyphs.For(ReferenceNodeKey.Leaf + suffix).length).toBeGreaterThan(0)
        }
    })

    it('tolerates an undefined icon key (the tree binds it before some rows have one)', () =>
    {
        // The row template converts HierarchyItemVM.IconKey, which is undefined for some
        // rows; For must not throw (a throw crashes every row's render → the tree never builds).
        expect(() => IconKeyGlyphs.For(undefined as unknown as string)).not.toThrow()
    })
})
