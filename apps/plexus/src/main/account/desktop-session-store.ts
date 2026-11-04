import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Structural twin of todl-platform-node's Encryptor (SafeStorageEncryptor satisfies it), kept
// local so this store has no Electron dependency and tests use a plain fake.
export interface ITokenEncryptor
{
    IsAvailable(): boolean;
    Encrypt(plain: string): Buffer;
    Decrypt(blob: Buffer): string;
}

// The signed-in desktop session. Lives only in the main process; the Token never crosses to the
// renderer.
export type DesktopSession = {
    TenantPlaneUrl: string;
    Token: string;
    Email: string;
    TenantId: string;
    TenantName: string;
    ExpiresAt: string;
}

// Persists the desktop session under the app userData dir as ONE OS-keyring-encrypted blob, written
// via temp + rename so a crash never leaves a half-written file and no plaintext token touches disk.
// A file that cannot be decrypted or parsed is useless, so it reads as signed out.
export class DesktopSessionStore
{
    private static readonly SessionFile = 'desktop-session.bin'
    private static readonly TempSuffix = '.tmp'
    private static readonly NotFoundCode = 'ENOENT'
    private static readonly EncryptionUnavailable = 'Secure storage is unavailable on this system; the session cannot be stored or read.'
    private static readonly Fields: readonly (keyof DesktopSession)[] = ['TenantPlaneUrl', 'Token', 'Email', 'TenantId', 'TenantName', 'ExpiresAt']

    public constructor(private readonly dir: string, private readonly encryptor: ITokenEncryptor)
    {
    }

    public async Save(session: DesktopSession): Promise<void>
    {
        if (!this.encryptor.IsAvailable()) throw new Error(DesktopSessionStore.EncryptionUnavailable)
        const blob = this.encryptor.Encrypt(JSON.stringify(DesktopSessionStore.Pick(session)))
        await fs.mkdir(this.dir, { recursive: true })
        const target = this.Path()
        const temp = `${target}${DesktopSessionStore.TempSuffix}`
        await fs.writeFile(temp, blob)
        await fs.rename(temp, target)
    }

    public async Load(): Promise<DesktopSession | undefined>
    {
        const blob = await this.ReadBlob()
        if (blob === undefined) return undefined
        if (!this.encryptor.IsAvailable()) throw new Error(DesktopSessionStore.EncryptionUnavailable)
        return this.Decode(blob)
    }

    public async Clear(): Promise<void>
    {
        await fs.rm(this.Path(), { force: true })
    }

    private Path(): string
    {
        return join(this.dir, DesktopSessionStore.SessionFile)
    }

    private Decode(blob: Buffer): DesktopSession | undefined
    {
        let parsed: unknown
        try
        {
            parsed = JSON.parse(this.encryptor.Decrypt(blob))
        }
        catch
        {
            return undefined
        }
        if (typeof parsed !== 'object' || parsed === null) return undefined
        const record = parsed as Record<string, unknown>
        const complete = DesktopSessionStore.Fields.every(f => typeof record[f] === 'string' && record[f] !== '')
        return complete ? DesktopSessionStore.Pick(record as DesktopSession) : undefined
    }

    // Copies exactly the session fields, so nothing extra is ever written or returned.
    private static Pick(s: DesktopSession): DesktopSession
    {
        return { TenantPlaneUrl: s.TenantPlaneUrl, Token: s.Token, Email: s.Email, TenantId: s.TenantId, TenantName: s.TenantName, ExpiresAt: s.ExpiresAt }
    }

    private async ReadBlob(): Promise<Buffer | undefined>
    {
        try
        {
            return await fs.readFile(this.Path())
        }
        catch (e)
        {
            if ((e as NodeJS.ErrnoException).code === DesktopSessionStore.NotFoundCode) return undefined
            throw e
        }
    }
}
