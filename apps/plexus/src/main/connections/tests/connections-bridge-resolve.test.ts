import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    PackageEngine, FileConnectionStore, EncryptedSecretStore, ConnectionTokenStore, ProcessEnvironmentVariables,
    type Encryptor,
} from '@pragmatic-tech-ai/plexus-core/main/connections'
import { createTgz, type HttpTransport, type HttpRequest, type HttpResponse } from '@pragmatic-tech-ai/todl/package-manager'
import { ConnectionsBridge } from '../connections-bridge.js'

class FakeEncryptor implements Encryptor
{
    public IsAvailable(): boolean { return true }
    public Encrypt(plain: string): Buffer { return Buffer.from(plain, 'utf8') }
    public Decrypt(blob: Buffer): string { return blob.toString('utf8') }
}

// An in-memory npm registry over the engine's HTTP transport seam: a URL→bytes router. Publish()
// registers a package's packument (pointing at a tarball URL, integrity omitted so the client
// skips SRI) and the tarball bytes; any unregistered URL is a 404 (drives the missing-package path).
class FakeRegistryTransport implements HttpTransport
{
    private readonly routes = new Map<string, Uint8Array>()
    private readonly encoder = new TextEncoder()

    constructor(private readonly registry: string)
    {
    }

    public Publish(name: string, version: string, tarball: Uint8Array): void
    {
        const tarballUrl = `${this.registry}/${FakeRegistryTransport.Slug(name)}/-/${version}.tgz`
        const packument = { 'dist-tags': { latest: version }, versions: { [version]: { dist: { tarball: tarballUrl } } } }
        this.routes.set(`${this.registry}/${FakeRegistryTransport.EncodeName(name)}`, this.encoder.encode(JSON.stringify(packument)))
        this.routes.set(tarballUrl, tarball)
    }

    public request(req: HttpRequest): Promise<HttpResponse>
    {
        const body = this.routes.get(req.url)
        if (body === undefined) return Promise.resolve({ status: 404, headers: {}, body: new Uint8Array() })
        return Promise.resolve({ status: 200, headers: {}, body })
    }

    // Mirrors NpmRegistry.encodeName (first '/' → %2F) so the packument URL matches exactly.
    private static EncodeName(name: string): string { return name.replace('/', '%2F') }
    private static Slug(name: string): string { return name.replace(/[^a-z0-9]+/gi, '_') }
}

const Registry = 'https://registry.test'
const Icon = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x3c, 0x3f, 0x78, 0x6d])   // 0xff/0xfe corrupt under a text round-trip
const Dep = { name: '@acme/dep', version: '1.0.0' }

function modelBytes(): Uint8Array
{
    return new TextEncoder().encode(JSON.stringify({ nodes: [], edges: [], dependencies: [Dep] }))
}

async function bridgeWith(transport: FakeRegistryTransport): Promise<ConnectionsBridge>
{
    const dir = mkdtempSync(join(tmpdir(), 'resolve-'))
    const engine = new PackageEngine({
        connectionStore: new FileConnectionStore(dir),
        secretStore: new EncryptedSecretStore(new ConnectionTokenStore(dir, new FakeEncryptor())),
        environment: new ProcessEnvironmentVariables({}),
        transport,
    })
    const b = new ConnectionsBridge(engine.Service)
    const view = await b.Add({ Id: '', DisplayName: 'test-reg', RegistryType: 'npm', Settings: { registry: Registry } })
    await b.SetToken(view.Id, 'dummy')
    await b.SetDefault(view.Id)
    return b
}

describe('ConnectionsBridge.Resolve', () =>
{
    it('resolves a published package into a SourcedPackage with a byte-faithful resource tree', async () =>
    {
        const transport = new FakeRegistryTransport(Registry)
        transport.Publish('@acme/widget', '1.2.3', createTgz([
            { path: 'package/model.json', bytes: modelBytes() },
            { path: 'package/resources/icon.svg', bytes: Icon },
        ]))
        const b = await bridgeWith(transport)

        const sourced = await b.Resolve('@acme/widget', '1.2.3')

        expect(sourced).toBeDefined()
        expect(sourced!.resources).toHaveLength(1)
        expect(sourced!.resources![0]!.path).toBe('icon.svg')                       // ResourcePrefix stripped
        expect(Array.from(sourced!.resources![0]!.bytes)).toEqual(Array.from(Icon))  // binary survives (the P5b/P6a guarantee)
        expect(sourced!.Dependencies).toEqual([Dep])
        expect((sourced!.Document as unknown as { nodes: unknown[]; edges: unknown[] }).nodes).toEqual([])
    })

    it('returns undefined for a package whose tarball has no model.json', async () =>
    {
        const transport = new FakeRegistryTransport(Registry)
        transport.Publish('@acme/nomodel', '1.0.0', createTgz([
            { path: 'package/resources/only.svg', bytes: Icon },
        ]))
        const b = await bridgeWith(transport)

        expect(await b.Resolve('@acme/nomodel', '1.0.0')).toBeUndefined()
    })

    it('returns undefined (best-effort) when the registry has no such package', async () =>
    {
        const b = await bridgeWith(new FakeRegistryTransport(Registry))   // nothing published

        expect(await b.Resolve('@acme/ghost', '9.9.9')).toBeUndefined()   // packument 404 → swallowed
    })
})
