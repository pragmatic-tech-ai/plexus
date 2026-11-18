import { afterEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import IpcUploadContributor from '../ipc-upload-contributor.js'

class FakeUpload
{
    public readonly Calls: unknown[][] = []
    public Reply: unknown = { Ok: true, Value: undefined }

    public Upload(t: TargetRef, n: string, tree: unknown[], c?: unknown): Promise<unknown>
    {
        this.Calls.push([t, n, tree, c])
        return Promise.resolve(this.Reply)
    }
}

class Targets
{
    public static readonly Dev: TargetRef = { Name: 'dev', Source: TargetSource.Console }
    public static readonly Wide = { Id: 'console:dev', Name: 'dev', Status: 'running', Source: TargetSource.Console } as TargetRef
}

describe('IpcUploadContributor', () =>
{
    afterEach(() =>
    {
        delete (globalThis as any).api
    })

    it('throws when the bridge is unavailable', () =>
    {
        (globalThis as any).api = {}
        expect(() => new IpcUploadContributor()).toThrow(/upload is unavailable/)
        delete (globalThis as any).api
        expect(() => new IpcUploadContributor()).toThrow(/upload is unavailable/)
    })

    it('calls window.api.upload.Upload with only Name and Source of the target', async () =>
    {
        const fake = new FakeUpload();
        (globalThis as any).api = { upload: fake }
        const tree = [{ Path: 'a.todl', Text: 'x' }]
        const contribution = { GraphName: 'g', SolutionId: 'S', Packages: [] }
        await new IpcUploadContributor().Upload(Targets.Wide, 'S', tree, contribution)
        expect(fake.Calls).toEqual([[Targets.Dev, 'S', tree, contribution]])
        expect(fake.Calls[0]![0]).toStrictEqual(Targets.Dev)
    })

    it('rejects with the failure sentence, rebuilding an account error', async () =>
    {
        const fake = new FakeUpload();
        (globalThis as any).api = { upload: fake }
        fake.Reply = { Ok: false, Error: { Message: 'The environment dev could not be reached.' } }
        await expect(new IpcUploadContributor().Upload(Targets.Dev, 'S', [])).rejects.toThrow('The environment dev could not be reached.')
        fake.Reply = { Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } }
        const error = await new IpcUploadContributor().Upload(Targets.Dev, 'S', []).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AccountError)
    })
})
