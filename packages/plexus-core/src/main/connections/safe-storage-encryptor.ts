/**
 * `SafeStorageEncryptor` — the production `Encryptor`, backed by Electron's OS-keyring
 * `safeStorage`. Isolated in its own file so the stores (and their unit tests) never import
 * Electron. Promoted from apps/devUI into plexus-core.
 */
import { safeStorage } from 'electron'
import type { Encryptor } from './encryptor.js'

export class SafeStorageEncryptor implements Encryptor
{
    public IsAvailable(): boolean
    {
        return safeStorage.isEncryptionAvailable()
    }

    public Encrypt(plain: string): Buffer
    {
        return safeStorage.encryptString(plain)
    }

    public Decrypt(blob: Buffer): string
    {
        return safeStorage.decryptString(blob)
    }
}
