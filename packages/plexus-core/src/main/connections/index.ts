/**
 * Barrel for the shared main-process connections module — the encrypted secret store,
 * connection store, environment adapter, and engine composition, promoted from apps/devUI
 * so apps/devUI and apps/plexus share one implementation. Consumed via the plexus-core
 * package export `@pragmatic-tech-ai/plexus-core/main/connections`.
 */
export type { Encryptor } from './encryptor.js'
export { SafeStorageEncryptor } from './safe-storage-encryptor.js'
export { ConnectionTokenStore } from './connection-token-store.js'
export { EncryptedSecretStore } from './encrypted-secret-store.js'
export { FileConnectionStore } from './file-connection-store.js'
export { ProcessEnvironmentVariables } from './process-environment-variables.js'
export { PackageEngine, type PackageEngineDeps } from './package-engine.js'
