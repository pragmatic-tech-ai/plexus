import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { TextValue } from './text-value.js'

// Structural twin of todl-platform-node's Encryptor (SafeStorageEncryptor satisfies it), kept
// local so this store has no Electron dependency and tests use a plain fake.
export interface ITokenEncryptor
{
    IsAvailable(): boolean;
    Encrypt(plain: string): Buffer;
    Decrypt(blob: Buffer): string;
}

// The signed-in desktop session. Lives only in the main process; the Token never crosses to the
// renderer. ConsoleUrl is the console the session was issued by (a tenant's own console, or the
// platform's tenant plane), where its targets, relay and sign-out go.
export type DesktopSession = {
    ConsoleUrl: string;
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
    private static readonly Fields: readonly (keyof DesktopSession)[] = ['ConsoleUrl', 'Token', 'Email', 'TenantId', 'TenantName', 'ExpiresAt']
    // Sessions saved before per-tenant consoles named their address TenantPlaneUrl (the platform's
    // tenant plane); they keep working there.
    private static readonly LegacyAddressField = 'TenantPlaneUrl'
    private static readonly AddressField: keyof DesktopSession = 'ConsoleUrl'

    public constructor(private readonly dir: string, private readonly encryptor: ITokenEncryptor)
    {
    }

    // Whether a session can be stored (and read back) on this system: checked before a sign-in opens
    // the browser, so the user is not sent through it for a session that could never be kept.
    public CanStore(): boolean
    {
        return this.encryptor.IsAvailable()
    }

    public async Save(session: DesktopSession): Promise<void>
    {
        if (!this.CanStore()) throw new AccountError(AccountErrorKind.SecureStorageUnavailable)
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
        if (!this.CanStore()) throw new AccountError(AccountErrorKind.SecureStorageUnavailable)
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
        const record = { ...(parsed as Record<string, unknown>) }
        const legacy = record[DesktopSessionStore.LegacyAddressField]
        if (!TextValue.Filled(record[DesktopSessionStore.AddressField]) && TextValue.Filled(legacy))
        {
            record[DesktopSessionStore.AddressField] = legacy
        }
        const complete = DesktopSessionStore.Fields.every(f => TextValue.Filled(record[f]))
        return complete ? DesktopSessionStore.Pick(record as DesktopSession) : undefined
    }

    // Copies exactly the session fields, so nothing extra is ever written or returned.
    private static Pick(s: DesktopSession): DesktopSession
    {
        return { ConsoleUrl: s.ConsoleUrl, Token: s.Token, Email: s.Email, TenantId: s.TenantId, TenantName: s.TenantName, ExpiresAt: s.ExpiresAt }
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
