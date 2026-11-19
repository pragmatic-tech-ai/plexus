import { describe, it, expect } from 'vitest'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ContentNodeKey } from '@pragmatic-tech-ai/todl'
import { IconKeyGlyphs, BuildFolderIconKey } from '../icon-key-to-geometry.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import { ConnectionNodeKey } from '../connection-node-key.js'

describe('IconKeyGlyphs.For', () =>
{
    it('maps every content key + member + solution to a non-empty glyph key', () =>
    {
        for (const key of [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Board, ContentNodeKey.Todl, NodeKey.Project, NodeKey.Solution])
        {
            expect(IconKeyGlyphs.For(key).length).toBeGreaterThan(0)
        }
    })

    it('folder and board map to distinct glyphs', () =>
    {
        expect(IconKeyGlyphs.For(ContentNodeKey.Folder)).not.toEqual(IconKeyGlyphs.For(ContentNodeKey.Board))
    })

    it('a todl file gets its own glyph, distinct from a plain file', () =>
    {
        expect(IconKeyGlyphs.For(ContentNodeKey.Todl)).not.toEqual(IconKeyGlyphs.For(ContentNodeKey.File))
    })

    it('the References branch node gets its own glyph; the per-kind group stays a folder', () =>
    {
        expect(IconKeyGlyphs.For(NodeKey.References)).toBe('References')
        expect(IconKeyGlyphs.For(ReferenceNodeKey.Group)).toBe('Folder')
    })

    it('the Solution root gets its own glyph', () =>
    {
        expect(IconKeyGlyphs.For(NodeKey.Solution)).toBe('SolutionNode')
    })

    it('every reference leaf resolution variant maps to a non-empty glyph', () =>
    {
        for (const suffix of ['-live', '-published', '-unresolved'])
        {
            expect(IconKeyGlyphs.For(ReferenceNodeKey.Leaf + suffix).length).toBeGreaterThan(0)
        }
    })

    it('the Connections branch node gets its own glyph; the active-connection group stays a folder', () =>
    {
        expect(IconKeyGlyphs.For(NodeKey.Connections)).toBe('ConnectionsFolder')
        expect(IconKeyGlyphs.For(ConnectionNodeKey.Active)).toBe('Folder')
    })

    it('every connection leaf health variant maps to a non-empty glyph', () =>
    {
        for (const suffix of ['-default', '-ready', '-nocreds', '-unreachable'])
        {
            expect(IconKeyGlyphs.For(ConnectionNodeKey.Leaf + suffix).length).toBeGreaterThan(0)
        }
    })

    it('a GitHub connection leaf maps to the GitHub glyph, distinct from the generic file glyph', () =>
    {
        for (const suffix of ['-default', '-ready', '-nocreds', '-unreachable'])
        {
            expect(IconKeyGlyphs.For(ConnectionNodeKey.GithubLeaf + suffix)).toBe('Github')
            expect(IconKeyGlyphs.For(ConnectionNodeKey.GithubLeaf + suffix)).not.toBe(IconKeyGlyphs.For(ConnectionNodeKey.Leaf + suffix))
        }
    })

    it('tolerates an undefined icon key (the tree binds it before some rows have one)', () =>
    {
        // The row template converts HierarchyItemVM.IconKey, which is undefined for some
        // rows; For must not throw (a throw crashes every row's render → the tree never builds).
        expect(() => IconKeyGlyphs.For(undefined as unknown as string)).not.toThrow()
    })
})

describe('IconKeyGlyphs.ForExpanded', () =>
{
    it('swaps every folder-glyph node to the open-folder glyph', () =>
    {
        for (const key of [ContentNodeKey.Folder, NodeKey.Project, ReferenceNodeKey.Group, ConnectionNodeKey.Active])
        {
            expect(IconKeyGlyphs.For(key)).toBe('Folder')
            expect(IconKeyGlyphs.ForExpanded(key)).toBe('FolderOpen')
        }
    })

    it('leaves a non-folder node glyph unchanged when expanded', () =>
    {
        expect(IconKeyGlyphs.ForExpanded(NodeKey.Solution)).toBe('SolutionNode')
        expect(IconKeyGlyphs.ForExpanded(NodeKey.References)).toBe('References')
        expect(IconKeyGlyphs.ForExpanded(NodeKey.Connections)).toBe('ConnectionsFolder')
        expect(IconKeyGlyphs.ForExpanded(ContentNodeKey.Board)).toBe(IconKeyGlyphs.For(ContentNodeKey.Board))
        expect(IconKeyGlyphs.ForExpanded(ContentNodeKey.File)).toBe(IconKeyGlyphs.For(ContentNodeKey.File))
    })

    it('keeps the build-folder glyph on expand (it is not a plain folder)', () =>
    {
        expect(IconKeyGlyphs.For(BuildFolderIconKey)).toBe('Build')
        expect(IconKeyGlyphs.ForExpanded(BuildFolderIconKey)).toBe('Build')
    })
})
