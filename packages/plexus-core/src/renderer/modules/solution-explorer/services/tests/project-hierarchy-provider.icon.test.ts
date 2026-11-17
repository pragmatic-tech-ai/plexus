import { describe, it, expect } from 'vitest'
import { ContentNodeKey, ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { ProjectHierarchyProvider } from '../project-hierarchy-provider.js'
import { BuildFolderIconKey } from '../icon-key-to-geometry.js'

describe('ProjectHierarchyProvider.IconKeyFor', () =>
{
    it('gives a root folder named "build" the build-folder key', () =>
    {
        expect(ProjectHierarchyProvider.IconKeyFor(ProjectNodeKind.Folder, 'build', 'build')).toBe(BuildFolderIconKey)
    })

    it('matches the build folder case-insensitively', () =>
    {
        expect(ProjectHierarchyProvider.IconKeyFor(ProjectNodeKind.Folder, 'Build', 'Build')).toBe(BuildFolderIconKey)
    })

    it('does not match a nested folder named "build"', () =>
    {
        expect(ProjectHierarchyProvider.IconKeyFor(ProjectNodeKind.Folder, 'build', 'concepts/build')).toBe(ContentNodeKey.For(ProjectNodeKind.Folder))
    })

    it('does not match a file named "build"', () =>
    {
        expect(ProjectHierarchyProvider.IconKeyFor(ProjectNodeKind.File, 'build', 'build')).toBe(ContentNodeKey.For(ProjectNodeKind.File))
    })

    it('gives every other folder its kind key', () =>
    {
        expect(ProjectHierarchyProvider.IconKeyFor(ProjectNodeKind.Folder, 'concepts', 'concepts')).toBe(ContentNodeKey.For(ProjectNodeKind.Folder))
    })
})
