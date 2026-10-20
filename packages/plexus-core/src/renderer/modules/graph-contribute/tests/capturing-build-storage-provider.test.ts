import { describe, it, expect } from 'vitest'
import { FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { IBuildStorageProvider, OpenedOutput, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import { CapturingBuildStorageProvider } from '../capturing-build-storage-provider.js'

// A counting delegate that returns a FRESH OpenedOutput on every OpenOutput call, so a cached
// (memoized) return is provably the first one rather than a re-open. It also tallies the sandbox
// pass-through calls.
class CountingDelegate implements IBuildStorageProvider
{
    public OpenCount = 0
    public CreateSandboxCount = 0
    public DeleteSandboxCount = 0

    public async CreateSandbox(): Promise<IStorage>
    {
        this.CreateSandboxCount++
        return new FakeStorage()
    }

    public async DeleteSandbox(_sandbox: IStorage): Promise<void>
    {
        this.DeleteSandboxCount++
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        this.OpenCount++
        return { Storage: new FakeStorage(), Path: `${outputName}:${options.OutputRootOverride ?? ''}` }
    }
}

describe('CapturingBuildStorageProvider', () =>
{
    it('records the returned storage under the OutputRootOverride', async () =>
    {
        const delegate = new CountingDelegate()
        const capturing = new CapturingBuildStorageProvider(delegate)
        const output = await capturing.OpenOutput('npm-package', { OutputRootOverride: 'p1' })
        expect(capturing.CapturedOutputs().get('p1')).toBe(output.Storage)
    })

    it('memoizes a repeat open of the same (name, root) and never re-opens the delegate', async () =>
    {
        const delegate = new CountingDelegate()
        const capturing = new CapturingBuildStorageProvider(delegate)
        const first = await capturing.OpenOutput('npm-package', { OutputRootOverride: 'p1' })
        const second = await capturing.OpenOutput('npm-package', { OutputRootOverride: 'p1' })
        expect(second).toBe(first)
        expect(delegate.OpenCount).toBe(1)
        expect(capturing.CapturedOutputs().get('p1')).toBe(first.Storage)
    })

    it('delegates again for a different OutputRootOverride and records the new key', async () =>
    {
        const delegate = new CountingDelegate()
        const capturing = new CapturingBuildStorageProvider(delegate)
        const a = await capturing.OpenOutput('npm-package', { OutputRootOverride: 'p1' })
        const b = await capturing.OpenOutput('npm-package', { OutputRootOverride: 'p2' })
        expect(delegate.OpenCount).toBe(2)
        expect(capturing.CapturedOutputs().get('p1')).toBe(a.Storage)
        expect(capturing.CapturedOutputs().get('p2')).toBe(b.Storage)
    })

    it('passes CreateSandbox and DeleteSandbox straight through to the delegate', async () =>
    {
        const delegate = new CountingDelegate()
        const capturing = new CapturingBuildStorageProvider(delegate)
        const sandbox = await capturing.CreateSandbox()
        await capturing.DeleteSandbox(sandbox)
        expect(delegate.CreateSandboxCount).toBe(1)
        expect(delegate.DeleteSandboxCount).toBe(1)
    })
})
