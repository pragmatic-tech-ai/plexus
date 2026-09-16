import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { StorageProviderRegistryBase } from '@pragmatic-tech-ai/plexus-core/renderer/services/storage'

import { FileSystemService } from '../file-system/file-system-service.js'
import { LocalFileStorage } from './local-file-storage.js'

// Plexus's storage registry. The registry mechanics (Register/Has/Create/
// CreateStorage, the backend-factory map, DefaultBackendId) live in plexus-core's
// StorageProviderRegistryBase; here we only declare the app's ServiceKey and
// register the built-in local-FS backend: a LocalFileStorage over the Electron
// FileSystemService, rooted at the given absolute folder. Additional backends
// register against the same inherited surface.
export class StorageProviderRegistry extends StorageProviderRegistryBase
{
    public static readonly Key = new ServiceKey<StorageProviderRegistry>('StorageProviderRegistry')

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.Register(
            StorageProviderRegistry.DefaultBackendId,
            (location) => new LocalFileStorage(location, this.Provider.getRequired(FileSystemService.Key)),
        )
    }
}
