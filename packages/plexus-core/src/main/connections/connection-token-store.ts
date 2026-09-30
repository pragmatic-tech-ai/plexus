/**
 * `ConnectionTokenStore` — per-connection auth tokens, encrypted at rest in `userData`,
 * keyed by connection id (`conn-token-<id>.bin`). The renderer never sees a token; only
 * `HasToken(id)` crosses the IPC bridge. Encryption is injected as an `Encryptor` so the
 * unit test runs with no Electron. When encryption is unavailable (a keyring-less Linux),
 * tokens are held in memory for the session and never written in plaintext.
 *
 * Promoted from apps/devUI into plexus-core, on-disk layout unchanged (byte-compat).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Encryptor } from './encryptor.js'

export class ConnectionTokenStore
{
    private static readonly FilePrefix = 'conn-token-'
    private static readonly FileSuffix = '.bin'

    private readonly memory = new Map<string, string>()

    constructor(private readonly userDataDir: string, private readonly encryptor: Encryptor)
    {
    }

    public HasToken(id: string): boolean
    {
        return this.GetToken(id).length > 0
    }

    public GetToken(id: string): string
    {
        const inMemory = this.memory.get(id)
        if (inMemory !== undefined && inMemory.length > 0) return inMemory
        const path = this.PathFor(id)
        if (!existsSync(path)) return ''
        return this.encryptor.Decrypt(readFileSync(path))
    }

    public SetToken(id: string, token: string): void
    {
        if (!this.encryptor.IsAvailable())
        {
            this.memory.set(id, token)   // session-only fallback; never write plaintext
            return
        }
        mkdirSync(this.userDataDir, { recursive: true })
        writeFileSync(this.PathFor(id), this.encryptor.Encrypt(token))
        this.memory.delete(id)
    }

    public Clear(id: string): void
    {
        this.memory.delete(id)
        const path = this.PathFor(id)
        if (existsSync(path)) rmSync(path)
    }

    private PathFor(id: string): string
    {
        return join(this.userDataDir, `${ConnectionTokenStore.FilePrefix}${id}${ConnectionTokenStore.FileSuffix}`)
    }
}
