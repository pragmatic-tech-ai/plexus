/**
 * Barrel for the shared main-process connections module — the encrypted secret store,
 * connection store, environment adapter, and engine composition. The neutral (Electron-free)
 * pieces live in `@pragmatic-tech-ai/todl-platform-node` and are re-exported here; only the
 * Electron-bound `SafeStorageEncryptor` stays local. Consumed via the plexus-core
 * package export `@pragmatic-tech-ai/plexus-core/main/connections`.
 */
export { SafeStorageEncryptor } from './safe-storage-encryptor.js'
export type { Encryptor } from '@pragmatic-tech-ai/todl-platform-node'
export {
    ConnectionTokenStore, EncryptedSecretStore, FileConnectionStore,
    ProcessEnvironmentVariables, PackageEngine, type PackageEngineDeps
} from '@pragmatic-tech-ai/todl-platform-node'
