import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppDeployResultDto, CypherAppDeployParamsDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { RunTestService } from '../run-test-service.js'
import { RelayAction, type IRelayConnector, type RelayClient } from '../../account/relay-connector.js'

class FakeClient
{
    public Loaded: CypherAppDeployParamsDto[] = []
    public Closed = 0

    public LoadRunTest(params: CypherAppDeployParamsDto): Promise<AppDeployResultDto>
    {
        this.Loaded.push(params)
        return Promise.resolve({ status: 'applied', appName: params.appName, appVersion: params.appVersion } as AppDeployResultDto)
    }

    public DisposeAsync(): Promise<void>
    {
        this.Closed++
        return Promise.resolve()
    }

    public CloseCode(): number | undefined
    {
        return undefined
    }
}

class FakeRelay implements IRelayConnector
{
    public Connects: Array<{ target: TargetRef; action: RelayAction }> = []

    constructor(public readonly Client: FakeClient)
    {
    }

    public Connect(target: TargetRef, action: RelayAction): Promise<RelayClient>
    {
        this.Connects.push({ target, action })
        return Promise.resolve(this.Client as unknown as RelayClient)
    }
}

class Fixture
{
    public static readonly Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }

    public static Output(): string
    {
        const dir = join(mkdtempSync(join(tmpdir(), 'run-test-')), 'build-remote')
        mkdirSync(dir, { recursive: true })
        const manifest = {
            name: 'orders', version: '0.2.0',
            packages: [{ id: 'my-arch', version: '0.2.0' }],
            ui: { entry: 'index.html', assets: ['index.html'] },
        }
        writeFileSync(join(dir, 'index.html'), '<html>app</html>')
        writeFileSync(join(dir, 'servable-manifest.json'), JSON.stringify(manifest))
        mkdirSync(join(dir, 'packages', 'my-arch', '0.2.0'), { recursive: true })
        writeFileSync(join(dir, 'packages', 'my-arch', '0.2.0', 'model.json'), '{"id":"my-arch"}')
        return dir
    }
}

describe('RunTestService', () =>
{
    it('assembles params from the build output and loads them over a RunTest relay', async () =>
    {
        const client = new FakeClient()
        const relay = new FakeRelay(client)
        const result = await new RunTestService(relay).Run(Fixture.Dev, Fixture.Output())
        expect(relay.Connects).toEqual([{ target: Fixture.Dev, action: RelayAction.RunTest }])
        expect(client.Loaded).toHaveLength(1)
        expect(client.Loaded[0].appName).toBe('orders')
        expect(client.Loaded[0].packages).toEqual([{ id: 'my-arch', version: '0.2.0', modelJson: '{"id":"my-arch"}' }])
        expect(client.Loaded[0].uiBundle).toEqual([{ path: 'index.html', contentBase64: Buffer.from('<html>app</html>').toString('base64') }])
        expect(result.appName).toBe('orders')
        expect(client.Closed).toBe(1)
    })

    it('refuses a directory that is not a remote build output without connecting', async () =>
    {
        const relay = new FakeRelay(new FakeClient())
        await expect(new RunTestService(relay).Run(Fixture.Dev, tmpdir())).rejects.toThrow()
        expect(relay.Connects).toHaveLength(0)
    })
})
