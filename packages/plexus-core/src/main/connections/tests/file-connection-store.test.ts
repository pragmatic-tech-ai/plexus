import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileConnectionStore } from '../file-connection-store.js'

describe('FileConnectionStore', () =>
{
    it('reads a connections.json written in the devUI spec layout (byte-compat)', async () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        writeFileSync(join(dir, 'connections.json'), JSON.stringify({
            version: 2, defaultId: 'npm-public',
            connections: [{ Id: 'npm-public', DisplayName: 'npm public', RegistryType: 'npm', Settings: { registry: 'https://r' } }],
        }))
        const store = new FileConnectionStore(dir)
        const all = await store.All()
        expect(all.map((c) => c.Id)).toEqual(['npm-public'])
        expect(await store.DefaultId()).toBe('npm-public')
    })

    it('maps a pre-engine flat record to a ConnectionSpec on load', async () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        writeFileSync(join(dir, 'connections.json'), JSON.stringify({
            defaultId: 'legacy',
            connections: [{ id: 'legacy', name: 'Legacy', registry: 'https://r', scope: '@x', org: '', githubApi: '', tokenSource: 'env', tokenEnvVar: 'NPM_TOKEN' }],
        }))
        const spec = (await new FileConnectionStore(dir).All())[0]!
        expect(spec.Id).toBe('legacy')
        expect(spec.DisplayName).toBe('Legacy')
        expect(spec.RegistryType).toBe('npm')
        expect(spec.Settings.scope).toBe('@x')
    })

    it('Save appends, adopts the first as default, and round-trips the spec format', async () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new FileConnectionStore(dir)
        await store.Save({ Id: 'a', DisplayName: 'A', RegistryType: 'npm', Settings: {} })
        expect(await store.DefaultId()).toBe('a')
        const written = JSON.parse(readFileSync(join(dir, 'connections.json'), 'utf8'))
        expect(written.connections[0].Id).toBe('a')
    })

    it('Delete removes the connection and repoints the default', async () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new FileConnectionStore(dir)
        await store.Save({ Id: 'a', DisplayName: 'A', RegistryType: 'npm', Settings: {} })
        await store.Save({ Id: 'b', DisplayName: 'B', RegistryType: 'npm', Settings: {} })
        await store.Delete('a')
        expect((await store.All()).map((c) => c.Id)).toEqual(['b'])
        expect(await store.DefaultId()).toBe('b')
    })
})
