import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { TenantServerUrl } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import type { ITenantProfileSource, TenantProfile } from './tenant-profile.js'

// Structural twin of todl-platform-node's Encryptor (SafeStorageEncryptor satisfies it), kept
// local so this store has no Electron or cross-package dependency and tests use a plain fake.
export interface ITokenEncryptor
{
    IsAvailable(): boolean;
    Encrypt(plain: string): Buffer;
    Decrypt(blob: Buffer): string;
}

// Persists the tenant profile under the app userData dir as ONE OS-keyring-encrypted blob
// holding both the server URL and the admin bearer token. A single file written via
// temp + rename means a crash can never leave a URL without its token (or the reverse), and no
// plaintext token ever touches disk. There is no read path that hands the token to the renderer.
// Load returns undefined only when nothing is configured; an unusable store (secure storage
// unavailable, unreadable blob) throws a distinct error so it is not mistaken for "no profile".
export class TenantProfileStore implements ITenantProfileSource
{
    private static readonly ProfileFile = 'tenant-profile.bin'
    private static readonly TempSuffix = '.tmp'
    private static readonly NotFoundCode = 'ENOENT'
    private static readonly EncryptionUnavailable = 'Secure storage is unavailable on this system; the tenant token cannot be stored or read.'
    private static readonly Unreadable = 'The stored tenant profile could not be read; use Configure tenant to set it again.'
    private static readonly EmptyProfile = 'Tenant server URL and token are both required.'

    constructor(private readonly dir: string, private readonly encryptor: ITokenEncryptor)
    {
    }

    public async Save(serverUrl: string, token: string): Promise<void>
    {
        if (serverUrl.trim() === '' || token === '') throw new Error(TenantProfileStore.EmptyProfile)
        const validated = TenantServerUrl.Validate(serverUrl)
        if (!this.encryptor.IsAvailable()) throw new Error(TenantProfileStore.EncryptionUnavailable)
        const blob = this.encryptor.Encrypt(JSON.stringify({ ServerUrl: validated, Token: token }))
        await fs.mkdir(this.dir, { recursive: true })
        const target = join(this.dir, TenantProfileStore.ProfileFile)
        const temp = `${target}${TenantProfileStore.TempSuffix}`
        await fs.writeFile(temp, blob)
        await fs.rename(temp, target)
    }

    public async Load(): Promise<TenantProfile | undefined>
    {
        const blob = await this.readBlob()
        if (blob === undefined) return undefined
        if (!this.encryptor.IsAvailable()) throw new Error(TenantProfileStore.EncryptionUnavailable)
        return this.decode(blob)
    }

    // Decrypt/parse failures are reported without any of the blob content.
    private decode(blob: Buffer): TenantProfile
    {
        try
        {
            const parsed = JSON.parse(this.encryptor.Decrypt(blob)) as { ServerUrl?: unknown; Token?: unknown }
            if (typeof parsed.ServerUrl === 'string' && typeof parsed.Token === 'string' && parsed.ServerUrl !== '' && parsed.Token !== '')
            {
                return { ServerUrl: parsed.ServerUrl, Token: parsed.Token }
            }
        }
        catch
        {
            // fall through to the single generic error
        }
        throw new Error(TenantProfileStore.Unreadable)
    }

    private async readBlob(): Promise<Buffer | undefined>
    {
        try
        {
            return await fs.readFile(join(this.dir, TenantProfileStore.ProfileFile))
        }
        catch (e)
        {
            if ((e as NodeJS.ErrnoException).code === TenantProfileStore.NotFoundCode) return undefined
            throw e
        }
    }
}
