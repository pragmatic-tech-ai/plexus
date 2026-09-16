import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'

import { iconKeyForKind, KindToGeometry, __resetKindGeometryCache } from '../project-node-icon.js'

// The leading glyph key each ProjectNodeKind maps to (resource keys registered
// in plexus-icons.mu). 'folder' reuses the command-bar @Folder; the file kinds
// each get their own glyph; anything unknown falls back to the generic file.
test('maps each node kind to its icon resource key', () => {
    expect(iconKeyForKind('folder')).toBe('Folder')
    expect(iconKeyForKind('diagram')).toBe('Diagram')
    expect(iconKeyForKind('todl')).toBe('Todl')
    expect(iconKeyForKind('file')).toBe('File')
})

test('falls back to the generic file glyph for an unrecognised kind', () => {
    expect(iconKeyForKind('mystery' as never)).toBe('File')
})

// KindToGeometry runs once per tree row; the project tree can be thousands of
// rows, and resolving the same handful of kind glyphs from the resource
// dictionary each time was a top CPU cost (ResourceDictionary.Resolve). The
// geometry for a kind is stable (theme-agnostic, registered once), so it's
// memoised by kind — the dictionary walk happens at most once per kind.
describe('KindToGeometry — memoised per kind', () => {
    const prev = Application.current
    let resolve: ReturnType<typeof vi.fn>

    beforeEach(() => {
        __resetKindGeometryCache()
        // Fresh object per Resolve call, so a non-memoised converter yields a
        // DIFFERENT instance on the second convert (and a higher call count).
        resolve = vi.fn((key: string) => ({ geom: key }))
        Application.current = { Resources: { Resolve: resolve } } as never
    })
    afterEach(() => { Application.current = prev; __resetKindGeometryCache() })

    test('repeated converts of the same kind reuse one resolved geometry', () => {
        const a = KindToGeometry.convert('diagram')
        const b = KindToGeometry.convert('diagram')
        expect(a).toBe(b)                                  // same instance
        expect(resolve).toHaveBeenCalledTimes(1)           // resolved once, not per row
        expect(resolve).toHaveBeenCalledWith('Diagram')
    })

    test('distinct kinds each resolve once', () => {
        KindToGeometry.convert('folder')
        KindToGeometry.convert('todl')
        KindToGeometry.convert('folder')
        expect(resolve).toHaveBeenCalledTimes(2)           // Folder + Todl, folder reused
    })

    test('a not-yet-mounted miss (undefined) is not cached — it retries', () => {
        resolve.mockReturnValueOnce(undefined)             // dictionary not mounted yet
        expect(KindToGeometry.convert('file')).toBeUndefined()
        const g = KindToGeometry.convert('file')           // now mounted
        expect(g).toEqual({ geom: 'File' })
        expect(resolve).toHaveBeenCalledTimes(2)           // re-resolved, miss not cached
    })
})
