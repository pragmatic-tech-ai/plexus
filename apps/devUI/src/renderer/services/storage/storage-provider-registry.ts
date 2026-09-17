import { ServiceKey, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { StorageProviderRegistryBase } from "@pragmatic-tech-ai/plexus-core/renderer/services/storage";
import { FileSystemService, LocalFileStorage } from "@pragmatic-tech-ai/plexus-core/renderer/file-system-storage";

// devUI's storage registry. The registry mechanics live in plexus-core's
// StorageProviderRegistryBase; here we declare the app's ServiceKey and register
// the built-in 'local' backend: the shared LocalFileStorage rooted at the
// location, over the shared FileSystemService (window.api.fs, composed by the
// FileSystemStorage module). Satisfies the solution package's
// IStorageProviderRegistry via the inherited CreateStorage.
export class AppStorageProviderRegistry extends StorageProviderRegistryBase {
  public static readonly Key = new ServiceKey<AppStorageProviderRegistry>("StorageProviderRegistry");

  constructor(provider: IServiceProvider) {
    super(provider);
    this.Register(
      AppStorageProviderRegistry.DefaultBackendId,
      (location) => new LocalFileStorage(location, provider.getRequired(FileSystemService.Key)),
    );
  }
}
