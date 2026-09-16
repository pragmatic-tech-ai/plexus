import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { ProjectRootFinder } from '../register-mcp-client.js'

describe('ProjectRootFinder', () => {
    test('returns the nearest ancestor holding project.plexus', () => {
        const root = join('/w', 'proj')
        const finder = new ProjectRootFinder((p) => p === join(root, 'project.plexus'))
        expect(finder.find(join(root, 'a', 'b'))).toBe(root)
    })
    test('returns undefined when no ancestor has one', () => {
        expect(new ProjectRootFinder(() => false).find(join('/w', 'proj', 'a'))).toBeUndefined()
    })
})
