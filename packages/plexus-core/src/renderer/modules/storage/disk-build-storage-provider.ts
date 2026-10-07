import { join } from 'node:path';
import { ServiceBase } from '@pragmatic-tech-ai/mural/runtime';
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import type { IEnvironment, IStorage } from '@pragmatic-tech-ai/todl-runtime';
import type { IBuildStorageProvider, OpenedOutput, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core';
import { BuildStorageProviderKey } from '@pragmatic-tech-ai/todl/todl-build-system';
import { StorageService } from './storage-service.js';
import { EnvironmentService } from '../../environment/environment-service.js';

// Disk-backed build-output provider: promotes a build's output into
// <OutputRootOverride>/<outputName>/ on disk and sandboxes each build under
// <userData>/build-sandboxes/. Registered under BuildStorageProviderKey so
// BuildService writes to disk instead of its in-memory default.
export class DiskBuildStorageProvider extends ServiceBase implements IBuildStorageProvider
{
    public static readonly Key = BuildStorageProviderKey;

    private static readonly LocalBackendId = 'local';
    private static readonly SandboxesDir = 'build-sandboxes';
    private static readonly SandboxPrefix = 'sandbox-';
    private static readonly RootPath = '';
    private static readonly MissingRootMessage = 'DiskBuildStorageProvider requires options.OutputRootOverride';

    private readonly runId = Date.now().toString(36);
    private counter = 0;

    constructor(provider: IServiceProvider)
    {
        super(provider);
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const root = options.OutputRootOverride;
        if (root === undefined || root.length === 0) throw new Error(DiskBuildStorageProvider.MissingRootMessage);
        const dir = join(root, outputName);
        const storage = this.storage.Create(DiskBuildStorageProvider.LocalBackendId, dir);
        if (await storage.Exists(DiskBuildStorageProvider.RootPath)) await storage.Delete(DiskBuildStorageProvider.RootPath);
        await storage.CreateDirectory(DiskBuildStorageProvider.RootPath);
        return { Storage: storage, Path: dir };
    }

    public async CreateSandbox(): Promise<IStorage>
    {
        const dir = join(this.env.UserDataDirectory, DiskBuildStorageProvider.SandboxesDir, `${DiskBuildStorageProvider.SandboxPrefix}${this.runId}-${this.counter++}`);
        const storage = this.storage.Create(DiskBuildStorageProvider.LocalBackendId, dir);
        await storage.CreateDirectory(DiskBuildStorageProvider.RootPath);
        return storage;
    }

    public async DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        await sandbox.Delete(DiskBuildStorageProvider.RootPath);
    }

    private get storage(): StorageService
    {
        return this.Provider.getRequired(StorageService.Key);
    }

    private get env(): IEnvironment
    {
        return this.Provider.getRequired(EnvironmentService.Key);
    }
}

export default DiskBuildStorageProvider;
