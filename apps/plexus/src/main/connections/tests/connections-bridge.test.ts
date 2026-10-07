import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    PackageEngine, FileConnectionStore, EncryptedSecretStore, ConnectionTokenStore, ProcessEnvironmentVariables,
    type Encryptor,
} from '@pragmatic-tech-ai/plexus-core/main/connections'
import type { PackageManagerService } from '@pragmatic-tech-ai/todl/package-manager'
import { ConnectionsBridge } from '../connections-bridge.js'

class FakeEncryptor implements Encryptor
{
    public IsAvailable(): boolean { return true }
    public Encrypt(plain: string): Buffer { return Buffer.from(plain, 'utf8') }
    public Decrypt(blob: Buffer): string { return blob.toString('utf8') }
}

function bridge(): ConnectionsBridge
{
    const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
    const engine = new PackageEngine({
        connectionStore: new FileConnectionStore(dir),
        secretStore: new EncryptedSecretStore(new ConnectionTokenStore(dir, new FakeEncryptor())),
        environment: new ProcessEnvironmentVariables({}),
    })
    return new ConnectionsBridge(engine.Service)
}

describe('ConnectionsBridge', () =>
{
    it('Add then List returns a ConnectionView with HasToken=false and no token field', async () =>
    {
        const b = bridge()
        await b.Add({ Id: '', DisplayName: 'npm-public', RegistryType: 'npm', Settings: {} })
        const views = await b.List()
        expect(views).toHaveLength(1)
        expect(views[0]!.DisplayName).toBe('npm-public')
        expect(views[0]!.HasToken).toBe(false)
        expect((views[0] as unknown as Record<string, unknown>).Token).toBeUndefined()   // secret never leaves main
    })

    it('adding two connections with the same display name mints distinct ids', async () =>
    {
        const b = bridge()
        await b.Add({ Id: '', DisplayName: 'dupe', RegistryType: 'npm', Settings: {} })
        await b.Add({ Id: '', DisplayName: 'dupe', RegistryType: 'npm', Settings: {} })
        const ids = (await b.List()).map((v) => v.Id)
        expect(new Set(ids).size).toBe(2)
    })

    it('SetDefault marks exactly one connection default', async () =>
    {
        const b = bridge()
        await b.Add({ Id: '', DisplayName: 'one', RegistryType: 'npm', Settings: {} })
        await b.Add({ Id: '', DisplayName: 'two', RegistryType: 'npm', Settings: {} })
        const second = (await b.List())[1]!.Id
        await b.SetDefault(second)
        const views = await b.List()
        expect(views.filter((v) => v.IsDefault).map((v) => v.Id)).toEqual([second])
    })

    it('Inspect maps every RegistryInspection field to the lowercase DTO and never leaks a token', async () =>
    {
        const secret = 'ghp_SECRET_TOKEN_VALUE'
        const inspection = {
            Ok: true, Message: 'HTTP 200', Identity: 'octocat',
            Scopes: ['read:packages'], ScopesSupported: true,
            Packages: ['p1', 'p2'], PackagesSupported: true,
            Token: secret,
        }
        const calls: string[] = []
        const service = {
            InspectConnection: async (id: string) =>
            {
                calls.push(id)
                return inspection
            },
        } as unknown as PackageManagerService
        const result = await new ConnectionsBridge(service).Inspect('conn-1')
        expect(calls).toEqual(['conn-1'])
        expect(result).toEqual({
            ok: true, message: 'HTTP 200', identity: 'octocat',
            scopes: ['read:packages'], scopesSupported: true,
            packages: ['p1', 'p2'], packagesSupported: true,
        })
        expect(JSON.stringify(result)).not.toContain(secret)
    })

    it('Inspect degrades a thrown engine error to an ok:false DTO instead of rejecting', async () =>
    {
        const service = {
            InspectConnection: async () =>
            {
                throw new Error('unknown connection')
            },
        } as unknown as PackageManagerService
        await expect(new ConnectionsBridge(service).Inspect('nope')).resolves.toEqual({
            ok: false, message: 'unknown connection', identity: '',
            scopes: [], scopesSupported: false, packages: [], packagesSupported: false,
        })
    })
})
