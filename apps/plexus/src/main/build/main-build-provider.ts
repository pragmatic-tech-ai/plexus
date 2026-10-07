import { join } from 'node:path'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { BuildService } from '@pragmatic-tech-ai/todl'
import { NodeProjectSystemComposer, BuildSystemRegistryKey } from '@pragmatic-tech-ai/todl/project-system'
import { StoragePackageStore, PackageStoreKey, BuildStorageProviderKey } from '@pragmatic-tech-ai/todl/todl-build-system'
import { parseManifest } from '@pragmatic-tech-ai/todl/package-manager'
import type { IBuildProgress, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import type { BuildApplicable } from '@pragmatic-tech-ai/plexus-core/shared/build-api.js'
import { MainDiskBuildStorageProvider } from './main-disk-build-storage-provider.js'

export interface MainBuildRequest
{
    projectRoot: string
    systemId: string
    flavorId?: string
    options?: BuildOptions
}

/**
 * Composes the todl node build pipeline once in the Electron main process and
 * exposes Build + Applicable to the IPC layer.
 */
export class MainBuildProvider
{
    private static readonly PackagesDir = 'packages'

    private readonly registry
    private readonly buildService: BuildService

    public constructor(userDataDir: string)
    {
        const container = new ServiceProvider()
        NodeProjectSystemComposer.Compose(container)
        container.registerInstance(PackageStoreKey, new StoragePackageStore(new NodeFsStorage(join(userDataDir, MainBuildProvider.PackagesDir))))
        container.registerInstance(BuildStorageProviderKey, new MainDiskBuildStorageProvider(userDataDir))
        this.registry = container.getRequired(BuildSystemRegistryKey)
        this.buildService = new BuildService(container)
    }

    public Build(req: MainBuildRequest, progress?: IBuildProgress): ReturnType<BuildService['Build']>
    {
        return this.buildService.Build(new NodeFsStorage(req.projectRoot), req.systemId, req.flavorId, progress, req.options)
    }

    public Applicable(manifestJson: string): readonly BuildApplicable[]
    {
        let manifest
        try
        {
            manifest = parseManifest(manifestJson)
        }
        catch
        {
            return []
        }
        return this.registry.For(manifest).flatMap((s) => s.Flavors().map((f) => (
            { systemId: s.Id, systemName: s.DisplayName, flavorId: f.Id, flavorName: f.DisplayName })))
    }
}
