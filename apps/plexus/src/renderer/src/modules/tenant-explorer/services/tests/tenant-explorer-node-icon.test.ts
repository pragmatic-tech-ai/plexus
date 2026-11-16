import { describe, expect, it } from 'vitest'

import { TenantExplorerNodeKind } from '../tenant-explorer-node.js'
import { iconKeyForKind } from '../tenant-explorer-node-icon.js'

describe('iconKeyForKind', () =>
{
    it('maps each kind to its glyph key', () =>
    {
        expect(iconKeyForKind(TenantExplorerNodeKind.Tenant)).toBe('Folder')
        expect(iconKeyForKind(TenantExplorerNodeKind.Environment)).toBe('ServerEnvironment')
        expect(iconKeyForKind(TenantExplorerNodeKind.Application)).toBe('AppGeneric')
        expect(iconKeyForKind(TenantExplorerNodeKind.Graph)).toBe('GraphNode')
        expect(iconKeyForKind(TenantExplorerNodeKind.Message)).toBe('File')
    })

    it('falls back to File for an unknown kind', () =>
    {
        expect(iconKeyForKind('bogus' as TenantExplorerNodeKind)).toBe('File')
    })
})
