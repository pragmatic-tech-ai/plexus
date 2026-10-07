import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import { DiskBuildStorageProvider } from '../disk-build-storage-provider.js'
import { StorageService } from '../storage-service.js'
import { EnvironmentService } from '../../../environment/environment-service.js'

// Tiny in-memory IStorage that records Delete/CreateDirectory (no real fs).
const Backslash = String.fromCharCode(92)
const StaleFile = 'stale.txt'
const StaleContent = 'old'
const UserData = '/userdata'
const OutputName = 'html-bundle'
const BuildRoot = '/proj/build'
const ExpectedOutputPath = '/proj/build/html-bundle'
const SandboxesPrefix = '/userdata/build-sandboxes/'

class MemStorage implements IStorage
{
    public readonly Files = new Map<string, string>()
    public Deleted = false
    private created = false

    constructor(public readonly Root: string)
    {
    }

    public ReadText(p: string): Promise<string>
    {
        return Promise.resolve(this.Files.get(p) ?? '')
    }

    public ReadBytes(): Promise<Uint8Array>
    {
        return Promise.resolve(new Uint8Array())
    }

    public WriteText(p: string, c: string): Promise<void>
    {
        this.Files.set(p, c)
        return Promise.resolve()
    }

    public WriteBytes(): Promise<void>
    {
        return Promise.resolve()
    }

    public Exists(p: string): Promise<boolean>
    {
        return Promise.resolve(p === '' ? this.Files.size > 0 || this.created : this.Files.has(p))
    }

    public Delete(): Promise<void>
    {
        this.Deleted = true
        this.created = false
        this.Files.clear()
        return Promise.resolve()
    }

    public CreateDirectory(): Promise<void>
    {
        this.created = true
        return Promise.resolve()
    }

    public Rename(): Promise<void>
    {
        return Promise.resolve()
    }

    public List(): Promise<readonly StorageEntry[]>
    {
        return Promise.resolve([])
    }
}

class Harness
{
    public static Norm(p: string): string
    {
        return p.split(Backslash).join('/')
    }

    public readonly Made: MemStorage[] = []

    public Build(seedStale: string | undefined): DiskBuildStorageProvider
    {
        const storageService = {
            Create: (_id: string, loc: string) =>
            {
                const s = new MemStorage(loc)
                if (Harness.Norm(loc) === seedStale) s.Files.set(StaleFile, StaleContent)
                this.Made.push(s)
                return s
            },
        }
        const provider = new ServiceProvider()
        provider.registerInstance(StorageService.Key, storageService as unknown as StorageService)
        provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: UserData } as unknown as EnvironmentService)
        return new DiskBuildStorageProvider(provider)
    }
}

test('OpenOutput roots at <override>/<outputName> and cleans a pre-existing dir', async () =>
{
    const h = new Harness()
    const provider = h.Build(ExpectedOutputPath)
    const out = await provider.OpenOutput(OutputName, { OutputRootOverride: BuildRoot } as never)
    const storage = out.Storage as MemStorage
    expect(Harness.Norm(out.Path)).toBe(ExpectedOutputPath)
    expect(Harness.Norm(storage.Root)).toBe(ExpectedOutputPath)
    expect(storage.Deleted).toBe(true)
    expect(storage.Files.has(StaleFile)).toBe(false)
})

test('OpenOutput throws without an output root override', async () =>
{
    const provider = new Harness().Build(undefined)
    await expect(provider.OpenOutput(OutputName, {} as never)).rejects.toThrow()
})

test('OpenOutput throws when the output root override is the empty string', async () =>
{
    const provider = new Harness().Build(undefined)
    await expect(provider.OpenOutput(OutputName, { OutputRootOverride: '' } as never)).rejects.toThrow()
})

test('CreateSandbox/DeleteSandbox mint and delete a userData sandbox dir', async () =>
{
    const provider = new Harness().Build(undefined)
    const a = await provider.CreateSandbox() as MemStorage
    const b = await provider.CreateSandbox() as MemStorage
    expect(a.Root).not.toBe(b.Root)
    expect(Harness.Norm(a.Root)).toContain(SandboxesPrefix)
    await provider.DeleteSandbox(a)
    expect(a.Deleted).toBe(true)
})
