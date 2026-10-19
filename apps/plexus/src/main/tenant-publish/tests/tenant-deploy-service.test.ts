import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDeployResultDto, CypherAppDeployParamsDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TenantDeployService } from '../tenant-deploy-service.js'
import type { ITenantClientFactory, ITenantDeployClient } from '../tenant-client.js'
import { TenantPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import type { ITenantProfileSource, TenantProfile } from '../tenant-profile.js'

class FakeProfiles implements ITenantProfileSource
{
    constructor(private readonly profile: TenantProfile | undefined)
    {
    }

    public Load(): Promise<TenantProfile | undefined>
    {
        return Promise.resolve(this.profile)
    }
}

class FakeClient implements ITenantDeployClient
{
    public Deployed: CypherAppDeployParamsDto[] = []
    public Closed = false

    public DeployApplication(params: CypherAppDeployParamsDto): Promise<AppDeployResultDto>
    {
        this.Deployed.push(params)
        return Promise.resolve({ status: 'applied', appName: params.appName, appVersion: params.appVersion } as AppDeployResultDto)
    }

    public Close(): Promise<void>
    {
        this.Closed = true
        return Promise.resolve()
    }
}

class FakeFactory implements ITenantClientFactory
{
    public Connects: Array<{ url: string; token: string }> = []

    constructor(public readonly Client: FakeClient, private readonly failWith?: Error)
    {
    }

    public Connect(url: string, token: string): Promise<ITenantDeployClient>
    {
        this.Connects.push({ url, token })
        if (this.failWith !== undefined) return Promise.reject(this.failWith)
        return Promise.resolve(this.Client)
    }
}

class Fixture
{
    public static readonly Secret = 'sekrit-admin-token'

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

    public static Profile(): TenantProfile
    {
        return { ServerUrl: 'wss://srv.example.com', Token: Fixture.Secret }
    }
}

describe('TenantDeployService', () =>
{
    let dir: string

    beforeEach(() => { dir = Fixture.Output() })
    afterEach(() => { rmSync(dirname(dir), { recursive: true, force: true }) })

    it('assembles the deploy payload from the remote build output and calls DeployApplication once', async () =>
    {
        const client = new FakeClient()
        const factory = new FakeFactory(client)
        const result = await new TenantDeployService(new FakeProfiles(Fixture.Profile()), factory).Deploy(dir)
        expect(factory.Connects).toEqual([{ url: 'wss://srv.example.com', token: Fixture.Secret }])
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
        expect(client.Closed).toBe(true)
    })

    it('errors clearly and makes no client call when no tenant profile is configured', async () =>
    {
        const client = new FakeClient()
        const factory = new FakeFactory(client)
        await expect(new TenantDeployService(new FakeProfiles(undefined), factory).Deploy(dir)).rejects.toThrow(/No tenant is configured/)
        expect(factory.Connects).toHaveLength(0)
        expect(client.Deployed).toHaveLength(0)
    })

    it('errors when the output has no servable manifest (not a remote build)', async () =>
    {
        const factory = new FakeFactory(new FakeClient())
        const empty = join(mkdtempSync(join(tmpdir(), 'tenant-empty-')), 'build-remote')
        mkdirSync(empty, { recursive: true })
        try
        {
            await expect(new TenantDeployService(new FakeProfiles(Fixture.Profile()), factory).Deploy(empty)).rejects.toThrow(/servable-manifest\.json/)
            expect(factory.Connects).toHaveLength(0)
        }
        finally
        {
            rmSync(dirname(empty), { recursive: true, force: true })
        }
    })

    it('never puts the token in a connect failure message', async () =>
    {
        const factory = new FakeFactory(new FakeClient(), new Error('ECONNREFUSED'))
        const err = await new TenantDeployService(new FakeProfiles(Fixture.Profile()), factory).Deploy(dir).catch((e: Error) => e)
        expect((err as Error).message).not.toMatch(/ECONNREFUSED/)
        expect((err as Error).message).not.toContain(Fixture.Secret)
    })

    it('reports a malformed manifest clearly', async () =>
    {
        writeFileSync(join(dir, 'servable-manifest.json'), '{ not json')
        const factory = new FakeFactory(new FakeClient())
        await expect(new TenantDeployService(new FakeProfiles(Fixture.Profile()), factory).Deploy(dir)).rejects.toThrow(/not valid JSON/)
        expect(factory.Connects).toHaveLength(0)
    })

    it('refuses a directory that is not a remote build output', async () =>
    {
        const factory = new FakeFactory(new FakeClient())
        await expect(new TenantDeployService(new FakeProfiles(Fixture.Profile()), factory).Deploy(tmpdir())).rejects.toThrow(/not a remote build output/)
        expect(factory.Connects).toHaveLength(0)
    })

    it('refuses a cleartext non-loopback server URL before connecting', async () =>
    {
        const factory = new FakeFactory(new FakeClient())
        const profile = { ServerUrl: 'ws://srv.example.com', Token: Fixture.Secret }
        const err = await new TenantDeployService(new FakeProfiles(profile), factory).Deploy(dir).catch((e: Error) => e)
        expect((err as Error).message).toMatch(/cleartext/)
        expect((err as Error).message).not.toContain(Fixture.Secret)
        expect(factory.Connects).toHaveLength(0)
    })

    it('rejects a manifest path escaping the build output', async () =>
    {
        writeFileSync(join(dir, 'servable-manifest.json'), JSON.stringify({
            name: 'x', version: '1', packages: [], ui: { entry: '../evil', assets: ['../evil'] },
        }))
        const factory = new FakeFactory(new FakeClient())
        await expect(new TenantDeployService(new FakeProfiles(Fixture.Profile()), factory).Deploy(dir)).rejects.toThrow(/outside the build output/)
    })
})
