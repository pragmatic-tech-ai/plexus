import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { StorageProviderRegistryBase } from '@pragmatic-tech-ai/plexus-core/renderer/services/storage'

import { FileSystemService } from '@pragmatic-tech-ai/plexus-core/renderer/file-system-storage'
import { LocalFileStorage } from '@pragmatic-tech-ai/plexus-core/renderer/file-system-storage'

// Plexus's storage registry. The registry mechanics (Register/Has/Create/
// CreateStorage, the backend-factory map, DefaultBackendId) and the shared
// StorageProviderRegistryBase.Key token live in plexus-core; here we only register
// the built-in local-FS backend: a LocalFileStorage over the Electron
// FileSystemService, rooted at the given absolute folder. Registered under the
// inherited Key, so core consumers (the Project Explorer) resolve this instance.
export class StorageProviderRegistry extends StorageProviderRegistryBase
{
    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.Register(
            StorageProviderRegistry.DefaultBackendId,
            (location) => new LocalFileStorage(location, this.Provider.getRequired(FileSystemService.Key)),
        )
    }
}
