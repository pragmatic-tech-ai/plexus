import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionLostError, ErrorCodes, ResponseError } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { AppDeployResultDto, CypherAppDeployParamsDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
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

    public CloseCode(): number | undefined
    {
        return undefined
    }
}

class FakeRelay implements IRelayConnector
{
    public Connects: Array<{ target: TargetRef; kind: TargetKind }> = []

    constructor(public readonly Client: FakeClient, private readonly failWith?: Error)
    {
    }

    public Connect(target: TargetRef, kind: TargetKind): Promise<RelayClient>
    {
        this.Connects.push({ target, kind })
        if (this.failWith !== undefined) return Promise.reject(this.failWith)
        return Promise.resolve(this.Client as unknown as RelayClient)
    }
}

class Fixture
{
    public static readonly Prod: TargetRef = { Name: 'prod', Source: TargetSource.Console }

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

    it('deploys through the session of the target source', async () =>
    {
        const relay = new FakeRelay(new FakeClient())
        await new TenantDeployService(relay).Deploy({ Name: 'prod', Source: TargetSource.Platform }, dir)
        expect(relay.Connects).toEqual([{ target: { Name: 'prod', Source: TargetSource.Platform }, kind: TargetKind.Publish }])
    })

    it('assembles the deploy payload and deploys once through a publish relay to the environment', async () =>
    {
        const client = new FakeClient()
        const relay = new FakeRelay(client)
        const result = await new TenantDeployService(relay).Deploy(Fixture.Prod,dir)
        expect(relay.Connects).toEqual([{ target: { Name: 'prod', Source: TargetSource.Console }, kind: TargetKind.Publish }])
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
        const client = new FakeClient(new ResponseError(ErrorCodes.InvalidRequest, 'pragmatic applications are not available on this connection'))
        await expect(new TenantDeployService(new FakeRelay(client)).Deploy(Fixture.Prod,dir)).rejects.toThrow('pragmatic applications are not available on this connection')
        expect(client.Closed).toBe(1)
    })

    it('maps a relay that drops mid-deploy to the unreachable sentence and closes', async () =>
    {
        for (const drop of [new ConnectionLostError(), new ResponseError(ErrorCodes.PendingResponseRejected, 'Pending response rejected since connection got disposed')])
        {
            const client = new FakeClient(drop)
            await expect(new TenantDeployService(new FakeRelay(client)).Deploy(Fixture.Prod,dir)).rejects.toThrow('The environment prod could not be reached.')
            expect(client.Closed).toBe(1)
        }
    })

    it('keeps a server JSON-RPC error message as it is', async () =>
    {
        const client = new FakeClient(new ResponseError(-32004, 'Application app1 1.0.0 conflicts with the deployed version'))
        await expect(new TenantDeployService(new FakeRelay(client)).Deploy(Fixture.Prod,dir)).rejects.toThrow('Application app1 1.0.0 conflicts with the deployed version')
    })

    it('maps a JSON-RPC protocol error (-32601 Method not found) to a fixed sentence and closes', async () =>
    {
        const client = new FakeClient(new ResponseError(ErrorCodes.MethodNotFound, 'This method is not available through the desktop relay.'))
        await expect(new TenantDeployService(new FakeRelay(client)).Deploy(Fixture.Prod,dir)).rejects.toThrow('The environment prod could not handle this request. It may need an update.')
        expect(client.Closed).toBe(1)
    })

    it('a failing close does not hide the deploy result', async () =>
    {
        const client = new FakeClient(undefined, true)
        const result = await new TenantDeployService(new FakeRelay(client)).Deploy(Fixture.Prod,dir)
        expect(result.Status).toBe(TenantPublishStatus.Applied)
        expect(client.Closed).toBe(1)
    })

    it('propagates the relay refusal sentence unchanged', async () =>
    {
        const relay = new FakeRelay(new FakeClient(), new Error('The environment prod is not running. Start it from the tenant console.'))
        await expect(new TenantDeployService(relay).Deploy(Fixture.Prod,dir)).rejects.toThrow('The environment prod is not running. Start it from the tenant console.')
    })

    it('errors when the output has no servable manifest (not a remote build), before any relay', async () =>
    {
        const relay = new FakeRelay(new FakeClient())
        const empty = join(mkdtempSync(join(tmpdir(), 'tenant-empty-')), 'build-remote')
        mkdirSync(empty, { recursive: true })
        try
        {
            await expect(new TenantDeployService(relay).Deploy(Fixture.Prod,empty)).rejects.toThrow(/servable-manifest\.json/)
            expect(relay.Connects).toHaveLength(0)
        }
        finally
        {
            rmSync(dirname(empty), { recursive: true, force: true })
        }
    })

    it('an unexpected failure reading the build output becomes a fixed sentence, logs only name and code, and never connects', async () =>
    {
        // A package entry whose id is not a string makes path.join throw a raw TypeError.
        writeFileSync(join(dir, 'servable-manifest.json'), JSON.stringify({
            name: 'orders', version: '0.2.0', packages: [{ id: 42, version: '0.2.0' }], ui: { entry: 'index.html', assets: [] },
        }))
        const relay = new FakeRelay(new FakeClient())
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try
        {
            const failure = await new TenantDeployService(relay).Deploy(Fixture.Prod,dir).then(() => undefined, (e: unknown) => e as Error)
            expect(failure?.message).toBe('The build output could not be read.')
            expect(relay.Connects).toEqual([])
            expect(warn).toHaveBeenCalledTimes(1)
            const logged = warn.mock.calls[0].map(String).join(' ')
            expect(logged).toContain('TypeError')
            expect(logged).not.toContain('Received')
            expect(logged).not.toContain(dir)
        }
        finally
        {
            warn.mockRestore()
        }
    })

    it('keeps its own sentence for a missing build file', async () =>
    {
        rmSync(join(dir, 'packages', 'prelude'), { recursive: true, force: true })
        await expect(new TenantDeployService(new FakeRelay(new FakeClient())).Deploy(Fixture.Prod,dir)).rejects.toThrow('Remote build output is missing: ')
    })

    it('reports a malformed manifest clearly', async () =>
    {
        writeFileSync(join(dir, 'servable-manifest.json'), '{ not json')
        const relay = new FakeRelay(new FakeClient())
        await expect(new TenantDeployService(relay).Deploy(Fixture.Prod,dir)).rejects.toThrow(/not valid JSON/)
        expect(relay.Connects).toHaveLength(0)
    })

    it('refuses a directory that is not a remote build output', async () =>
    {
        const relay = new FakeRelay(new FakeClient())
        await expect(new TenantDeployService(relay).Deploy(Fixture.Prod,tmpdir())).rejects.toThrow(/not a remote build output/)
        expect(relay.Connects).toHaveLength(0)
    })

    it('rejects a manifest path escaping the build output', async () =>
    {
        writeFileSync(join(dir, 'servable-manifest.json'), JSON.stringify({
            name: 'x', version: '1', packages: [], ui: { entry: '../evil', assets: ['../evil'] },
        }))
        const relay = new FakeRelay(new FakeClient())
        await expect(new TenantDeployService(relay).Deploy(Fixture.Prod,dir)).rejects.toThrow(/outside the build output/)
        expect(relay.Connects).toHaveLength(0)
    })
})
