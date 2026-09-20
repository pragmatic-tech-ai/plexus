/**
 * `PackageEngine` — composes the TODL package engine for the devUI host. It builds a
 * ServiceProvider with the engine's npm factories + catalog + PackageManagerService,
 * and the three host seams (connection store, secret store, environment variables)
 * the app supplies, then exposes the resolved `PackageManagerService` the
 * RegistryBridge drives. This is the app-side equivalent of composing the engine's
 * PackageServicesEngine .mu module — done in TS because the module is not a public
 * subpath.
 */
import { ServiceProvider, ServiceLifetime } from "@pragmatic-tech-ai/todl-runtime";
import {
  PackageManagerService,
  PackageRegistryCatalogKey,
  DefaultPackageRegistryCatalog,
  NpmPackageRegistryFactory,
  NpmConnectionFactory,
  ConnectionStoreKey,
  SecretStoreKey,
  EnvironmentVariablesKey,
  HttpTransportKey,
  type IConnectionStore,
  type ISecretStore,
  type IEnvironmentVariables,
  type HttpTransport,
} from "@pragmatic-tech-ai/todl/package-manager";

export interface PackageEngineDeps
{
  connectionStore: IConnectionStore;
  secretStore: ISecretStore;
  environment: IEnvironmentVariables;
  /** An alternate HTTP transport (tests inject an in-memory fake); FetchTransport
   *  otherwise. */
  transport?: HttpTransport;
}

export class PackageEngine
{
  public readonly Service: PackageManagerService;

  constructor(deps: PackageEngineDeps)
  {
    const provider = new ServiceProvider();
    provider.registerInstance(ConnectionStoreKey, deps.connectionStore);
    provider.registerInstance(SecretStoreKey, deps.secretStore);
    provider.registerInstance(EnvironmentVariablesKey, deps.environment);
    if (deps.transport !== undefined) provider.registerInstance(HttpTransportKey, deps.transport);
    provider.register(NpmPackageRegistryFactory.Key, (p) => new NpmPackageRegistryFactory(p), ServiceLifetime.Singleton);
    provider.register(NpmConnectionFactory.Key, (p) => new NpmConnectionFactory(p), ServiceLifetime.Singleton);
    provider.register(PackageRegistryCatalogKey, (p) => new DefaultPackageRegistryCatalog(p), ServiceLifetime.Singleton);
    provider.register(PackageManagerService.Key, (p) => new PackageManagerService(p), ServiceLifetime.Singleton);
    this.Service = provider.getRequired(PackageManagerService.Key);
  }
}
