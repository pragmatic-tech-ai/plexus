import type { IServiceContainer, IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { HtmlBundleBuildSystem, PackageStoreKey, StoragePackageStore, BuildStorageProviderKey } from '@pragmatic-tech-ai/todl'
import { BundlerKey } from '@pragmatic-tech-ai/todl/build-system-core'
import { EnvironmentService } from '../../environment/environment-service.js'
import { FileSystemService } from '../storage/file-system-service.js'
import { LocalFileStorage } from '../storage/local-file-storage.js'
import { RendererBuildStorageProvider } from './renderer-build-storage-provider.js'
import { IpcBundler } from './ipc-bundler.js'

// Binds todl's three build seams on the renderer root and registers the html-bundle
// system. The root already ran ProjectSystemComposer (via TodlProjectSystemModule), so
// this deliberately does NOT re-compose it.
export class BuildComposition
{
    private static readonly PackagesDir = 'packages'

    public static Compose(container: IServiceContainer): void
    {
        // Lazy factories: EnvironmentService/FileSystemService are resolved on first use, so
        // module ordering never matters (the container has no getRequired; providers do).
        container.registerInstance(BundlerKey, new IpcBundler())
        container.register(BuildStorageProviderKey, (p: IServiceProvider) =>
        {
            const env = p.getRequired(EnvironmentService.Key)
            return new RendererBuildStorageProvider(env.UserDataDirectory, p.getRequired(FileSystemService.Key), env.PathSeparator)
        })
        container.register(PackageStoreKey, (p: IServiceProvider) =>
        {
            const env = p.getRequired(EnvironmentService.Key)
            const root = `${env.UserDataDirectory}${env.PathSeparator}${BuildComposition.PackagesDir}`
            return new StoragePackageStore(new LocalFileStorage(root, p.getRequired(FileSystemService.Key)))
        })
        HtmlBundleBuildSystem.Register(container)
    }
}
