import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { AccountError, AccountErrorKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { UploadIpc } from '../upload-ipc.js'
import { UploadChannel, type UploadContribution, type UploadEntry } from '../../../shared/upload-api.js'
import type { UploadService } from '../upload-service.js'

type Handler = (event: unknown, ...args: any[]) => unknown

class FakeIpc
{
    public readonly Handlers = new Map<string, Handler>()
    public handle(channel: string, handler: Handler): void
    {
        this.Handlers.set(channel, handler)
    }
}

class FakeService
{
    public Calls: unknown[][] = []
    public Failure: Error | undefined

    public async Upload(target: TargetRef, name: string, tree: readonly UploadEntry[], contribution?: UploadContribution): Promise<void>
    {
        this.Calls.push([target, name, tree, contribution])
        if (this.Failure !== undefined) throw this.Failure
    }
}

class Harness
{
    public readonly Ipc = new FakeIpc()
    public readonly Service = new FakeService()

    public constructor()
    {
        UploadIpc.Register(this.Ipc as unknown as IpcMain, this.Service as unknown as UploadService)
    }

    public Invoke(...args: unknown[]): Promise<any>
    {
        return Promise.resolve(this.Ipc.Handlers.get(UploadChannel.Upload)!({}, ...args))
    }
}

describe('UploadIpc', () =>
{
    const Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }
    const Tree: UploadEntry[] = [{ Path: 'S.pksln', Text: '{}' }, { Path: 'a.bin', BytesBase64: 'AA==' }]
    const Contribution: UploadContribution = { GraphName: 'main', SolutionId: 'S', Packages: [{ id: 'p', version: '1.0.0', modelJson: '{}' }] }
    const Malformed = { Ok: false, Error: { Message: 'The upload request was malformed.' } }

    it('binds exactly the upload channel', () =>
    {
        const h = new Harness()
        expect(Object.values(UploadChannel)).toEqual(['upload:upload'])
        expect([...h.Ipc.Handlers.keys()]).toEqual(['upload:upload'])
    })

    it('forwards to the service and answers an Ok envelope', async () =>
    {
        const h = new Harness()
        const reply = await h.Invoke({ Name: 'dev', Source: 'console', Token: 'secret' }, 'S', Tree, Contribution)
        expect(reply).toEqual({ Ok: true, Value: undefined })
        expect(h.Service.Calls).toEqual([[Dev, 'S', Tree, Contribution]])
    })

    it('forwards without a contribution', async () =>
    {
        const h = new Harness()
        await h.Invoke(Dev, 'S', Tree)
        expect(h.Service.Calls).toEqual([[Dev, 'S', Tree, undefined]])
    })

    it('answers a failure as its sentence, keeping the account kind', async () =>
    {
        const h = new Harness()
        h.Service.Failure = new Error('The environment dev is not running.')
        expect(await h.Invoke(Dev, 'S', Tree)).toEqual({ Ok: false, Error: { Message: 'The environment dev is not running.' } })
        h.Service.Failure = new AccountError(AccountErrorKind.SignedOut)
        expect(await h.Invoke(Dev, 'S', Tree)).toEqual({ Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } })
    })

    it('trims the solution name before forwarding', async () =>
    {
        const h = new Harness()
        await h.Invoke(Dev, '  S  ', Tree)
        expect(h.Service.Calls).toEqual([[Dev, 'S', Tree, undefined]])
    })

    it('refuses unsafe entry paths at the trust boundary before the service', async () =>
    {
        const h = new Harness()
        for (const path of ['../x', 'a\\b', '/abs', 'C:/x', 'a\u0000b', 'a/../../x', '.. ', '...', 'a/.. /x'])
        {
            expect(await h.Invoke(Dev, 'S', [{ Path: path, Text: 't' }])).toEqual({ Ok: false, Error: { Message: expect.stringContaining('unsafe path') } })
        }
        expect(h.Service.Calls).toEqual([])
    })

    it('forwards the cleaned entry path', async () =>
    {
        const h = new Harness()
        await h.Invoke(Dev, 'S', [{ Path: './a//b', Text: 't' }])
        expect(h.Service.Calls).toEqual([[Dev, 'S', [{ Path: 'a/b', Text: 't' }], undefined]])
    })

    it('refuses malformed arguments before the service', async () =>
    {
        const h = new Harness()
        const bad = [
            await h.Invoke('dev', 'S', Tree),
            await h.Invoke({ Name: 'dev', Source: 'x' }, 'S', Tree),
            await h.Invoke(Dev, '', Tree),
            await h.Invoke(Dev, 7, Tree),
            await h.Invoke(Dev, 'S', 'nope'),
            await h.Invoke(Dev, 'S', [{ Text: 'no path' }]),
            await h.Invoke(Dev, 'S', [{ Path: 'a', Text: 5 }]),
            await h.Invoke(Dev, 'S', Tree, 'nope'),
            await h.Invoke(Dev, 'S', Tree, { GraphName: 'g', SolutionId: 's', Packages: 'x' }),
            await h.Invoke(Dev, 'S', Tree, { GraphName: '', SolutionId: 's', Packages: [] }),
            await h.Invoke(Dev, 'S', Tree, { GraphName: 'g', SolutionId: 's', Packages: [{ id: 'p', version: '1' }] }),
            await h.Invoke(Dev, 'S', Tree, { GraphName: 'g', SolutionId: 's', Packages: [null] }),
            await h.Invoke(Dev, 'S', Tree, { GraphName: 'g', SolutionId: 's', Packages: [{ id: 1, version: '1', modelJson: '{}' }] }),
        ]
        for (const reply of bad) expect(reply).toEqual(Malformed)
        expect(h.Service.Calls).toEqual([])
    })
})
