import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ITenantProfileSource, TenantProfile } from './tenant-profile.js'

// Structural twin of todl-platform-node's Encryptor (SafeStorageEncryptor satisfies it), kept
// local so this store has no Electron or cross-package dependency and tests use a plain fake.
export interface ITokenEncryptor
{
    IsAvailable(): boolean;
    Encrypt(plain: string): Buffer;
    Decrypt(blob: Buffer): string;
}

// Persists the tenant profile under the app's userData dir: the non-secret server URL in a JSON
// file, the admin bearer token only as an OS-keyring-encrypted blob. No plaintext token is ever
// written to disk, and there is no read path that hands the token to the renderer.
export class TenantProfileStore implements ITenantProfileSource
{
    private static readonly ProfileFile = 'tenant-profile.json'
    private static readonly TokenFile = 'tenant-token.bin'
    private static readonly Encoding = 'utf8'
    private static readonly EncryptionUnavailable = 'Secure storage is unavailable; cannot store the tenant token.'
    private static readonly EmptyProfile = 'Tenant server URL and token are both required.'

    constructor(private readonly dir: string, private readonly encryptor: ITokenEncryptor)
    {
    }

    public async Save(serverUrl: string, token: string): Promise<void>
    {
        if (serverUrl.trim() === '' || token === '') throw new Error(TenantProfileStore.EmptyProfile)
        if (!this.encryptor.IsAvailable()) throw new Error(TenantProfileStore.EncryptionUnavailable)
        await fs.mkdir(this.dir, { recursive: true })
        await fs.writeFile(this.path(TenantProfileStore.ProfileFile), JSON.stringify({ ServerUrl: serverUrl.trim() }), TenantProfileStore.Encoding)
        await fs.writeFile(this.path(TenantProfileStore.TokenFile), this.encryptor.Encrypt(token))
    }

    public async Load(): Promise<TenantProfile | undefined>
    {
        const url = await this.readUrl()
        const blob = await this.readBlob()
        if (url === undefined || blob === undefined || !this.encryptor.IsAvailable()) return undefined
        return { ServerUrl: url, Token: this.encryptor.Decrypt(blob) }
    }

    private async readUrl(): Promise<string | undefined>
    {
        try
        {
            const parsed = JSON.parse(await fs.readFile(this.path(TenantProfileStore.ProfileFile), TenantProfileStore.Encoding)) as { ServerUrl?: unknown }
            return typeof parsed.ServerUrl === 'string' && parsed.ServerUrl !== '' ? parsed.ServerUrl : undefined
        }
        catch
        {
            return undefined
        }
    }

    private async readBlob(): Promise<Buffer | undefined>
    {
        try
        {
            return await fs.readFile(this.path(TenantProfileStore.TokenFile))
        }
        catch
        {
            return undefined
        }
    }

    private path(file: string): string
    {
        return join(this.dir, file)
    }
}
