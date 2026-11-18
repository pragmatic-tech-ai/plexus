import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import type { AppDeployResultDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import { AccountError, AccountErrorKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { EnvironmentPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/environment-publish-api.js'
import { EnvironmentRunTestApi } from '../environment-run-test-api.js'
import { RunTestIpc } from '../run-test-ipc.js'
import { RunTestChannel } from '../../../shared/run-test-api.js'
import type { RunTestService } from '../run-test-service.js'

class FakeRunTest
{
    public Calls: Array<[TargetRef, string]> = []

    public Run(target: TargetRef, outputDir: string): Promise<AppDeployResultDto>
    {
        this.Calls.push([target, outputDir])
        return Promise.resolve({ status: 'applied', appName: 'orders', appVersion: '1' } as AppDeployResultDto)
    }
}

class FakeSessions
{
    public Asked: TargetSource[] = []

    constructor(private readonly consoleUrl: string | undefined)
    {
    }

    public SessionFor(source: TargetSource): Promise<{ ConsoleUrl: string; Token: string } | undefined>
    {
        this.Asked.push(source)
        return Promise.resolve(this.consoleUrl === undefined ? undefined : { ConsoleUrl: this.consoleUrl, Token: 't' })
    }
}

describe('EnvironmentRunTestApi', () =>
{
    const Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }

    it('loads the build and answers the served-app URL on the source console origin', async () =>
    {
        const run = new FakeRunTest()
        const sessions = new FakeSessions('https://console.acme.test/')
        const result = await new EnvironmentRunTestApi(run as unknown as RunTestService, sessions as any).Run(Dev, '/p/build-remote')
        expect(run.Calls).toEqual([[Dev, '/p/build-remote']])
        expect(sessions.Asked).toEqual([TargetSource.Console])
        expect(result).toEqual({ Status: EnvironmentPublishStatus.Applied, Reason: undefined, AppName: 'orders', AppVersion: '1', AppUrl: 'https://console.acme.test/app/dev/orders/' })
    })

    it('fails signed-out before loading anything', async () =>
    {
        const run = new FakeRunTest()
        const api = new EnvironmentRunTestApi(run as unknown as RunTestService, new FakeSessions(undefined) as any)
        await expect(api.Run(Dev, '/p/build-remote')).rejects.toEqual(new AccountError(AccountErrorKind.SignedOut))
        expect(run.Calls).toEqual([])
    })

    it('encodes the environment and app names in the URL path', async () =>
    {
        const api = new EnvironmentRunTestApi(new FakeRunTest() as unknown as RunTestService, new FakeSessions('https://c.test') as any)
        expect((await api.Run({ Name: 'my env', Source: TargetSource.Console }, '/p/build-remote')).AppUrl).toBe('https://c.test/app/my%20env/orders/')
    })
})

describe('RunTestIpc', () =>
{
    it('binds the run channel, answers an Ok envelope and refuses malformed arguments', async () =>
    {
        const handlers = new Map<string, (...a: any[]) => unknown>()
        const calls: unknown[][] = []
        const api = { Run: (t: TargetRef, d: string) => { calls.push([t, d]); return Promise.resolve({ Status: EnvironmentPublishStatus.Applied, AppName: 'o', AppVersion: '1', AppUrl: 'u' }) } }
        RunTestIpc.Register({ handle: (c: string, h: any) => handlers.set(c, h) } as unknown as IpcMain, api)
        expect([...handlers.keys()]).toEqual([RunTestChannel.Run])
        const run = handlers.get(RunTestChannel.Run)!
        const dev = { Name: 'dev', Source: 'console' }
        expect(await run({}, { ...dev, Token: 'x' }, '/p/build-remote')).toEqual({ Ok: true, Value: { Status: 'applied', AppName: 'o', AppVersion: '1', AppUrl: 'u' } })
        expect(calls).toEqual([[dev, '/p/build-remote']])
        expect(await run({}, 'dev', '/p')).toEqual({ Ok: false, Error: { Message: 'The run/test request was malformed.' } })
        expect(await run({}, dev, 3)).toEqual({ Ok: false, Error: { Message: 'The run/test request was malformed.' } })
    })
})
