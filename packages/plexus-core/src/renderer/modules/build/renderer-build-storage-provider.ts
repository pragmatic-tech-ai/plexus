import type { IBuildStorageProvider, OpenedOutput, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { LocalFileStorage } from '../storage/local-file-storage.js'
import type { FileSystemService } from '../storage/file-system-service.js'

// Renderer build storage: LocalFileStorage over the IPC fs bridge. Mirrors the
// main-process MainDiskBuildStorageProvider, but is TOLERANT of a missing
// OutputRootOverride — it falls back to <userData>/build-output.
export class RendererBuildStorageProvider implements IBuildStorageProvider
{
    private static readonly SandboxesDir = 'build-sandboxes'
    private static readonly SandboxPrefix = 'sandbox-'
    private static readonly OutputDir = 'build-output'
    private static readonly RootPath = ''

    private readonly runId = Date.now().toString(36)
    private counter = 0

    public constructor(
        private readonly userDataDir: string,
        private readonly fs: FileSystemService,
        private readonly separator: string)
    {
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const root = options.OutputRootOverride ?? this.Join(this.userDataDir, RendererBuildStorageProvider.OutputDir)
        const dir = this.Join(root, outputName)
        const storage = new LocalFileStorage(dir, this.fs)
        if (await storage.Exists(RendererBuildStorageProvider.RootPath))
        {
            await storage.Delete(RendererBuildStorageProvider.RootPath)
        }
        await storage.CreateDirectory(RendererBuildStorageProvider.RootPath)
        return { Storage: storage, Path: dir }
    }

    public async CreateSandbox(): Promise<IStorage>
    {
        const dir = this.Join(
            this.userDataDir,
            RendererBuildStorageProvider.SandboxesDir,
            `${RendererBuildStorageProvider.SandboxPrefix}${this.runId}-${this.counter++}`)
        const storage = new LocalFileStorage(dir, this.fs)
        await storage.CreateDirectory(RendererBuildStorageProvider.RootPath)
        return storage
    }

    public async DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        await sandbox.Delete(RendererBuildStorageProvider.RootPath)
    }

    private Join(...parts: readonly string[]): string
    {
        return parts.join(this.separator)
    }
}
