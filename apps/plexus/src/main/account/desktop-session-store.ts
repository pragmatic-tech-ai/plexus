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

// Where a session lives and the token that proves it: all a sign-out or a targets call needs.
// ConsoleUrl is the console the session was issued by (a tenant's own console, or the platform's
// tenant plane), where its targets, relay and sign-out go.
export type SessionAddress = {
    ConsoleUrl: string;
    Token: string;
}

// The signed-in desktop session. Lives only in the main process; the Token never crosses to the
// renderer. PlatformSignInUrl, when set, is the tenant plane to offer the platform sign-in step at.
export type DesktopSession = SessionAddress & {
    Email: string;
    TenantId: string;
    TenantName: string;
    ExpiresAt: string;
    PlatformSignInUrl?: string;
}

// The second session, at the platform's tenant plane (ConsoleUrl), for the platform's environments.
export type PlatformSession = SessionAddress & {
    ExpiresAt: string;
    TenantId: string;
    Email: string;
}

// Everything stored for the account: either part may be absent.
export type StoredAccount = {
    Console?: DesktopSession;
    Platform?: PlatformSession;
}

// Persists the account under the app userData dir as ONE OS-keyring-encrypted blob, written via
// temp + rename so a crash never leaves a half-written file and no plaintext token touches disk.
// The console part's fields sit flat at the top level (so an older Plexus still reads it), the
// platform sign-in address beside them, and the platform part nested under Platform. A file that
// cannot be decrypted or parsed is useless, so it reads as signed out; an incomplete part is dropped
// on its own.
export class DesktopSessionStore
{
    private static readonly SessionFile = 'desktop-session.bin'
    private static readonly TempSuffix = '.tmp'
    private static readonly NotFoundCode = 'ENOENT'
    private static readonly ConsoleFields: readonly (keyof DesktopSession)[] = ['ConsoleUrl', 'Token', 'Email', 'TenantId', 'TenantName', 'ExpiresAt']
    private static readonly PlatformFields: readonly (keyof PlatformSession)[] = ['ConsoleUrl', 'Token', 'ExpiresAt', 'TenantId', 'Email']
    private static readonly PlatformField = 'Platform'
    private static readonly PlatformSignInField: keyof DesktopSession = 'PlatformSignInUrl'
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

    // Writes both parts as one blob; an account with neither part removes the file.
    public async Save(account: StoredAccount): Promise<void>
    {
        if (!this.CanStore()) throw new AccountError(AccountErrorKind.SecureStorageUnavailable)
        if (account.Console === undefined && account.Platform === undefined)
        {
            await this.Clear()
            return
        }
        const blob = this.encryptor.Encrypt(JSON.stringify(DesktopSessionStore.Encode(account)))
        await fs.mkdir(this.dir, { recursive: true })
        const target = this.Path()
        const temp = `${target}${DesktopSessionStore.TempSuffix}`
        await fs.writeFile(temp, blob)
        await fs.rename(temp, target)
    }

    public async Load(): Promise<StoredAccount>
    {
        const blob = await this.ReadBlob()
        if (blob === undefined) return DesktopSessionStore.Empty()
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

    private Decode(blob: Buffer): StoredAccount
    {
        let parsed: unknown
        try
        {
            parsed = JSON.parse(this.encryptor.Decrypt(blob))
        }
        catch
        {
            return DesktopSessionStore.Empty()
        }
        if (!DesktopSessionStore.IsRecord(parsed)) return DesktopSessionStore.Empty()
        return { Console: DesktopSessionStore.DecodeConsole(parsed), Platform: DesktopSessionStore.DecodePlatform(parsed[DesktopSessionStore.PlatformField]) }
    }

    private static DecodeConsole(parsed: Record<string, unknown>): DesktopSession | undefined
    {
        const record = { ...parsed }
        const legacy = record[DesktopSessionStore.LegacyAddressField]
        if (!TextValue.Filled(record[DesktopSessionStore.AddressField]) && TextValue.Filled(legacy))
        {
            record[DesktopSessionStore.AddressField] = legacy
        }
        const complete = DesktopSessionStore.ConsoleFields.every(f => TextValue.Filled(record[f]))
        return complete ? DesktopSessionStore.PickConsole(record as DesktopSession) : undefined
    }

    private static DecodePlatform(value: unknown): PlatformSession | undefined
    {
        if (!DesktopSessionStore.IsRecord(value)) return undefined
        const complete = DesktopSessionStore.PlatformFields.every(f => TextValue.Filled(value[f]))
        return complete ? DesktopSessionStore.PickPlatform(value as PlatformSession) : undefined
    }

    // The blob: the console part flat, the platform part nested; only the listed fields are written.
    private static Encode(account: StoredAccount): Record<string, unknown>
    {
        const record: Record<string, unknown> = account.Console === undefined ? {} : { ...DesktopSessionStore.PickConsole(account.Console) }
        if (account.Platform !== undefined) record[DesktopSessionStore.PlatformField] = DesktopSessionStore.PickPlatform(account.Platform)
        return record
    }

    // Copies exactly the console part's fields (the platform sign-in address only when set), so
    // nothing extra is ever written or returned.
    private static PickConsole(s: DesktopSession): DesktopSession
    {
        const picked: DesktopSession = { ConsoleUrl: s.ConsoleUrl, Token: s.Token, Email: s.Email, TenantId: s.TenantId, TenantName: s.TenantName, ExpiresAt: s.ExpiresAt }
        const signIn = s[DesktopSessionStore.PlatformSignInField]
        if (TextValue.Filled(signIn)) picked.PlatformSignInUrl = signIn
        return picked
    }

    private static PickPlatform(s: PlatformSession): PlatformSession
    {
        return { ConsoleUrl: s.ConsoleUrl, Token: s.Token, ExpiresAt: s.ExpiresAt, TenantId: s.TenantId, Email: s.Email }
    }

    private static IsRecord(value: unknown): value is Record<string, unknown>
    {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    private static Empty(): StoredAccount
    {
        return { Console: undefined, Platform: undefined }
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
