import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeployResultDto, CypherAppDeployParamsDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TenantDeployService } from '../tenant-deploy-service.js'
import { TenantPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import type { IRelayConnector, RelayClient } from '../../account/relay-connector.js'

class FakeClient
{
    public Deployed: CypherAppDeployParamsDto[] = []
    public Closed = 0

    constructor(private readonly failWith?: Error, private readonly closeFails = false)
    {
    }

    public DeployApplication(params: CypherAppDeployParamsDto): Promise<AppDeployResultDto>
    {
        this.Deployed.push(params)
        if (this.failWith !== undefined) return Promise.reject(this.failWith)
        return Promise.resolve({ status: 'applied', appName: params.appName, appVersion: params.appVersion } as AppDeployResultDto)
    }

    public DisposeAsync(): Promise<void>
    {
        this.Closed++
        return this.closeFails ? Promise.reject(new Error('close failed')) : Promise.resolve()
    }
}

class FakeRelay implements IRelayConnector
{
    public Connects: Array<{ environment: string; kind: TargetKind }> = []

    constructor(public readonly Client: FakeClient, private readonly failWith?: Error)
    {
    }

    public Connect(environment: string, kind: TargetKind): Promise<RelayClient>
    {
        this.Connects.push({ environment, kind })
        if (this.failWith !== undefined) return Promise.reject(this.failWith)
        return Promise.resolve(this.Client as unknown as RelayClient)
    }
}

class Fixture
{
    public static Output(): string
    {
        const dir = join(mkdtempSync(join(tmpdir(), 'tenant-deploy-')), 'build-remote')
        mkdirSync(dir, { recursive: true })
        const manifest = {
            name: 'orders', version: '0.2.0',
            packages: [{ id: 'my-arch', version: '0.2.0' }, { id: 'prelude', version: '1.0.0' }],
            ui: { entry: 'index.html', assets: ['index.html'] },
        }
        writeFileSync(join(dir, 'index.html'), '<html>app</html>')
        writeFileSync(join(dir, 'servable-manifest.json'), JSON.stringify(manifest))
        for (const p of manifest.packages)
        {
            mkdirSync(join(dir, 'packages', p.id, p.version), { recursive: true })
            writeFileSync(join(dir, 'packages', p.id, p.version, 'model.json'), `{"id":"${p.id}"}`)
        }
        return dir
    }
}

describe('TenantDeployService', () =>
{
    let dir: string

    beforeEach(() => { dir = Fixture.Output() })
    afterEach(() => { rmSync(dirname(dir), { recursive: true, force: true }) })

    it('assembles the deploy payload and deploys once through a publish relay to the environment', async () =>
    {
        const client = new FakeClient()
        const relay = new FakeRelay(client)
        const result = await new TenantDeployService(relay).Deploy('prod', dir)
        expect(relay.Connects).toEqual([{ environment: 'prod', kind: TargetKind.Publish }])
        expect(client.Deployed).toHaveLength(1)
        const sent = client.Deployed[0]
        expect(sent.appName).toBe('orders')
        expect(sent.appVersion).toBe('0.2.0')
        expect(sent.manifest.ui.entry).toBe('index.html')
        expect(sent.packages).toEqual([
            { id: 'my-arch', version: '0.2.0', modelJson: '{"id":"my-arch"}' },
            { id: 'prelude', version: '1.0.0', modelJson: '{"id":"prelude"}' },
        ])
        expect(sent.uiBundle).toEqual([{ path: 'index.html', contentBase64: Buffer.from('<html>app</html>').toString('base64') }])
        expect(result).toEqual({ Status: TenantPublishStatus.Applied, Reason: undefined, AppName: 'orders', AppVersion: '0.2.0' })
        expect(client.Closed).toBe(1)
    })

    it('closes the client when the deploy rejects and propagates the server message', async () =>
    {
        const client = new FakeClient(new Error('This method is not available through the desktop relay.'))
        await expect(new TenantDeployService(new FakeRelay(client)).Deploy('prod', dir)).rejects.toThrow(/not available through the desktop relay/)
        expect(client.Closed).toBe(1)
    })

    it('a failing close does not hide the deploy result', async () =>
    {
        const client = new FakeClient(undefined, true)
        const result = await new TenantDeployService(new FakeRelay(client)).Deploy('prod', dir)
        expect(result.Status).toBe(TenantPublishStatus.Applied)
        expect(client.Closed).toBe(1)
    })

    it('propagates the relay refusal sentence unchanged', async () =>
    {
        const relay = new FakeRelay(new FakeClient(), new Error('The environment prod is not running. Start it from the tenant console.'))
        await expect(new TenantDeployService(relay).Deploy('prod', dir)).rejects.toThrow('The environment prod is not running. Start it from the tenant console.')
    })

    it('errors when the output has no servable manifest (not a remote build), before any relay', async () =>
    {
        const relay = new FakeRelay(new FakeClient())
        const empty = join(mkdtempSync(join(tmpdir(), 'tenant-empty-')), 'build-remote')
        mkdirSync(empty, { recursive: true })
        try
        {
            await expect(new TenantDeployService(relay).Deploy('prod', empty)).rejects.toThrow(/servable-manifest\.json/)
            expect(relay.Connects).toHaveLength(0)
        }
        finally
        {
            rmSync(dirname(empty), { recursive: true, force: true })
        }
    })

    it('reports a malformed manifest clearly', async () =>
    {
        writeFileSync(join(dir, 'servable-manifest.json'), '{ not json')
        const relay = new FakeRelay(new FakeClient())
        await expect(new TenantDeployService(relay).Deploy('prod', dir)).rejects.toThrow(/not valid JSON/)
        expect(relay.Connects).toHaveLength(0)
    })

    it('refuses a directory that is not a remote build output', async () =>
    {
        const relay = new FakeRelay(new FakeClient())
        await expect(new TenantDeployService(relay).Deploy('prod', tmpdir())).rejects.toThrow(/not a remote build output/)
        expect(relay.Connects).toHaveLength(0)
    })

    it('rejects a manifest path escaping the build output', async () =>
    {
        writeFileSync(join(dir, 'servable-manifest.json'), JSON.stringify({
            name: 'x', version: '1', packages: [], ui: { entry: '../evil', assets: ['../evil'] },
        }))
        const relay = new FakeRelay(new FakeClient())
        await expect(new TenantDeployService(relay).Deploy('prod', dir)).rejects.toThrow(/outside the build output/)
        expect(relay.Connects).toHaveLength(0)
    })
})
