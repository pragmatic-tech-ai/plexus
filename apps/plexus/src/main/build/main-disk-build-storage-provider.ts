import { join } from 'node:path'
import type { IBuildStorageProvider, OpenedOutput, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'

// Main-process disk build storage: a node-fs port of the renderer's
// DiskBuildStorageProvider. Outputs land at <OutputRootOverride>/<outputName>
// (cleaned before write); sandboxes are unique dirs under <userData>/build-sandboxes.
export class MainDiskBuildStorageProvider implements IBuildStorageProvider
{
    private static readonly SandboxesDir = 'build-sandboxes'
    private static readonly SandboxPrefix = 'sandbox-'
    private static readonly RootPath = ''
    private static readonly MissingRootMessage = 'MainDiskBuildStorageProvider requires options.OutputRootOverride'

    private readonly runId = Date.now().toString(36)
    private counter = 0

    public constructor(private readonly userDataDir: string)
    {
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const root = options.OutputRootOverride
        if (!root)
        {
            throw new Error(MainDiskBuildStorageProvider.MissingRootMessage)
        }
        const dir = join(root, outputName)
        const storage = new NodeFsStorage(dir)
        if (await storage.Exists(MainDiskBuildStorageProvider.RootPath))
        {
            await storage.Delete(MainDiskBuildStorageProvider.RootPath)
        }
        await storage.CreateDirectory(MainDiskBuildStorageProvider.RootPath)
        return { Storage: storage, Path: dir }
    }

    public async CreateSandbox(): Promise<IStorage>
    {
        const dir = join(
            this.userDataDir,
            MainDiskBuildStorageProvider.SandboxesDir,
            `${MainDiskBuildStorageProvider.SandboxPrefix}${this.runId}-${this.counter++}`)
        const storage = new NodeFsStorage(dir)
        await storage.CreateDirectory(MainDiskBuildStorageProvider.RootPath)
        return storage
    }

    public async DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        await sandbox.Delete(MainDiskBuildStorageProvider.RootPath)
    }
}
