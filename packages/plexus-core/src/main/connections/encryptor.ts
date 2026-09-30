/**
 * `Encryptor` — the encryption seam for the connection secret stores. `IsAvailable()`
 * gates whether secrets may be written to disk; when it returns false (a keyring-less
 * environment) callers hold secrets in memory for the session and never write plaintext.
 * Injected so the stores run under unit test with no Electron; production wires
 * `SafeStorageEncryptor` (Electron `safeStorage`).
 *
 * Promoted from apps/devUI into plexus-core so both apps share one implementation of
 * this security-sensitive code. The on-disk byte layout is unchanged from devUI.
 */
export interface Encryptor
{
    IsAvailable(): boolean
    Encrypt(plain: string): Buffer
    Decrypt(blob: Buffer): string
}
