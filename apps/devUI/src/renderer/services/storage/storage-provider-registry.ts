import { ServiceKey, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { StorageProviderRegistryBase } from "@pragmatic-tech-ai/plexus-core/renderer/services/storage";
import type { TodlBridge } from "../../env.js";
import { AppLocalStorage } from "./app-local-storage.js";

// devUI's storage registry. The registry mechanics live in plexus-core's
// StorageProviderRegistryBase; here we declare the app's ServiceKey and register
// the built-in 'local' backend: an AppLocalStorage over the `window.todl` fs
// bridge (read `__todlBridge` first so an e2e can inject a fake, falling back to
// the deep-frozen `window.todl`). Satisfies the solution package's
// IStorageProviderRegistry via the inherited CreateStorage.
export class AppStorageProviderRegistry extends StorageProviderRegistryBase {
  public static readonly Key = new ServiceKey<AppStorageProviderRegistry>("StorageProviderRegistry");

  constructor(provider: IServiceProvider) {
    super(provider);
    this.Register(AppStorageProviderRegistry.DefaultBackendId, (location) => new AppLocalStorage(location, this.bridge().fs));
  }

  private bridge(): TodlBridge {
    return (window as unknown as { __todlBridge?: TodlBridge }).__todlBridge ?? window.todl;
  }
}
