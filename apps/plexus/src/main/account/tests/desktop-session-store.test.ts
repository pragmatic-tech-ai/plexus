import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DesktopSessionStore, type DesktopSession, type PlatformSession } from '../desktop-session-store.js'
import { ReverseEncryptor } from './reverse-encryptor.js'

// The store's file in a test dir, read and written through the reverse encryptor.
class BlobFile
{
    private static readonly FileName = 'desktop-session.bin'

    public constructor(private readonly dir: string, private readonly encryptor: ReverseEncryptor)
    {
    }

    public get Path(): string
    {
        return join(this.dir, BlobFile.FileName)
    }

    public Read(): Record<string, unknown>
    {
        return JSON.parse(this.encryptor.Decrypt(readFileSync(this.Path))) as Record<string, unknown>
    }

    public Write(value: unknown): void
    {
        writeFileSync(this.Path, this.encryptor.Encrypt(JSON.stringify(value)))
    }
}

describe('DesktopSessionStore', () =>
{
    const session: DesktopSession = {
        ConsoleUrl: 'https://console-acme.example', Token: 'plain-token-123', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2026-11-11T00:00:00.000Z',
    }
    const platform: PlatformSession = {
        ConsoleUrl: 'https://platform.example/tenant-plane', Token: 'plain-platform-456', ExpiresAt: '2026-11-12T00:00:00.000Z', TenantId: 't1', Email: 'ada@acme.example',
    }
    const legacy = { Token: 'plain-token-123', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2026-11-11T00:00:00.000Z' }
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'desktop-session-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })


    it('round-trips the console part as one encrypted file and never writes the token in plaintext', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        await store.Save({ Console: session })
        expect(await store.Load()).toEqual({ Console: session, Platform: undefined })
        expect(readdirSync(dir)).toEqual(['desktop-session.bin'])
        expect(readFileSync(join(dir, 'desktop-session.bin')).toString()).not.toContain('plain-token-123')
    })

    it('round-trips both parts, with the platform sign-in address, in one blob', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        const offered: DesktopSession = { ...session, PlatformSignInUrl: 'https://platform.example/tenant-plane' }
        await store.Save({ Console: offered, Platform: platform })
        expect(await store.Load()).toEqual({ Console: offered, Platform: platform })
        expect(readdirSync(dir)).toEqual(['desktop-session.bin'])
        const raw = readFileSync(join(dir, 'desktop-session.bin')).toString()
        expect(raw).not.toContain('plain-token-123')
        expect(raw).not.toContain('plain-platform-456')
    })

    it('round-trips a platform part with no console part', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        await store.Save({ Platform: platform })
        expect(await store.Load()).toEqual({ Console: undefined, Platform: platform })
    })

    it('Save({}) removes the file', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        await store.Save({ Console: session, Platform: platform })
        await store.Save({})
        expect(readdirSync(dir)).toEqual([])
        expect(await store.Load()).toEqual({ Console: undefined, Platform: undefined })
    })

    it('loads neither part when nothing is stored, and after Clear', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        expect(await store.Load()).toEqual({ Console: undefined, Platform: undefined })
        await store.Save({ Console: session, Platform: platform })
        await store.Clear()
        expect(await store.Load()).toEqual({ Console: undefined, Platform: undefined })
        await store.Clear()
        expect(readdirSync(dir)).toEqual([])
    })

    it('treats an unreadable file as signed out', async () =>
    {
        writeFileSync(join(dir, 'desktop-session.bin'), 'garbage')
        expect(await new DesktopSessionStore(dir, new ReverseEncryptor()).Load()).toEqual({ Console: undefined, Platform: undefined })
    })

    it('refuses to save when secure storage is unavailable, with the SecureStorageUnavailable kind', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor(false))
        expect(store.CanStore()).toBe(false)
        await expect(store.Save({ Console: session })).rejects.toEqual(new AccountError(AccountErrorKind.SecureStorageUnavailable))
        await expect(store.Save({ Platform: platform })).rejects.toBeInstanceOf(AccountError)
        expect(readdirSync(dir)).toEqual([])
    })

    it('a legacy console-only blob loads as the console part with no platform part and no platform sign-in address', async () =>
    {
        const encryptor = new ReverseEncryptor()
        new BlobFile(dir, encryptor).Write(session)
        const loaded = await new DesktopSessionStore(dir, encryptor).Load()
        expect(loaded).toEqual({ Console: session, Platform: undefined })
        expect(loaded.Console!.PlatformSignInUrl).toBeUndefined()
    })

    it('Load maps a legacy TenantPlaneUrl blob to ConsoleUrl', async () =>
    {
        const encryptor = new ReverseEncryptor()
        new BlobFile(dir, encryptor).Write({ TenantPlaneUrl: 'http://127.0.0.1:7002', ...legacy })
        expect(await new DesktopSessionStore(dir, encryptor).Load()).toEqual({ Console: { ConsoleUrl: 'http://127.0.0.1:7002', ...legacy }, Platform: undefined })
    })

    it('a platform part with an empty Token loads as no platform part, keeping the console part', async () =>
    {
        const encryptor = new ReverseEncryptor()
        new BlobFile(dir, encryptor).Write({ ...session, Platform: { ...platform, Token: '' } })
        expect(await new DesktopSessionStore(dir, encryptor).Load()).toEqual({ Console: session, Platform: undefined })
    })

    it('a platform part missing any field is dropped', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const store = new DesktopSessionStore(dir, encryptor)
        for (const field of Object.keys(platform) as (keyof PlatformSession)[])
        {
            const partial: Record<string, unknown> = { ...platform }
            delete partial[field]
            new BlobFile(dir, encryptor).Write({ ...session, Platform: partial })
            expect(await store.Load()).toEqual({ Console: session, Platform: undefined })
        }
        new BlobFile(dir, encryptor).Write({ ...session, Platform: 'not-an-object' })
        expect(await store.Load()).toEqual({ Console: session, Platform: undefined })
    })

    it('an incomplete console part is dropped without dropping a complete platform part', async () =>
    {
        const encryptor = new ReverseEncryptor()
        new BlobFile(dir, encryptor).Write({ ...session, TenantName: '', PlatformSignInUrl: 'https://platform.example/tenant-plane', Platform: platform })
        expect(await new DesktopSessionStore(dir, encryptor).Load()).toEqual({ Console: undefined, Platform: platform })
    })

    it('an empty platform sign-in address loads as unset', async () =>
    {
        const encryptor = new ReverseEncryptor()
        new BlobFile(dir, encryptor).Write({ ...session, PlatformSignInUrl: '' })
        const loaded = await new DesktopSessionStore(dir, encryptor).Load()
        expect(loaded.Console).toEqual(session)
        expect(Object.keys(loaded.Console!)).not.toContain('PlatformSignInUrl')
    })

    it('Save writes only the listed fields: console flat, the platform sign-in address beside them, the platform part nested', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const store = new DesktopSessionStore(dir, encryptor)
        await store.Save({
            Console: { ...session, PlatformSignInUrl: 'https://platform.example/tenant-plane', TenantPlaneUrl: 'http://127.0.0.1:7002' } as DesktopSession,
            Platform: { ...platform, TenantName: 'Acme', Extra: 'x' } as PlatformSession,
            Extra: 'x',
        } as Parameters<DesktopSessionStore['Save']>[0])
        const blob = new BlobFile(dir, encryptor).Read()
        expect(blob['ConsoleUrl']).toBe('https://console-acme.example')
        expect(Object.keys(blob).sort()).toEqual(['ConsoleUrl', 'Email', 'ExpiresAt', 'Platform', 'PlatformSignInUrl', 'TenantId', 'TenantName', 'Token'])
        expect(Object.keys(blob['Platform'] as object).sort()).toEqual(['ConsoleUrl', 'Email', 'ExpiresAt', 'TenantId', 'Token'])
    })

    it('Save omits the platform sign-in address and the platform part when unset', async () =>
    {
        const encryptor = new ReverseEncryptor()
        await new DesktopSessionStore(dir, encryptor).Save({ Console: session })
        expect(Object.keys(new BlobFile(dir, encryptor).Read()).sort()).toEqual(['ConsoleUrl', 'Email', 'ExpiresAt', 'TenantId', 'TenantName', 'Token'])
        await new DesktopSessionStore(dir, encryptor).Save({ Platform: platform })
        expect(Object.keys(new BlobFile(dir, encryptor).Read())).toEqual(['Platform'])
    })

    it('a blob with neither address reads as signed out', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const store = new DesktopSessionStore(dir, encryptor)
        new BlobFile(dir, encryptor).Write(legacy)
        expect(await store.Load()).toEqual({ Console: undefined, Platform: undefined })
        new BlobFile(dir, encryptor).Write({ ConsoleUrl: '', TenantPlaneUrl: '', ...legacy })
        expect(await store.Load()).toEqual({ Console: undefined, Platform: undefined })
    })

    it('CanStore follows the encryptor', () =>
    {
        expect(new DesktopSessionStore(dir, new ReverseEncryptor()).CanStore()).toBe(true)
    })

    it('a stored session cannot be read once secure storage is unavailable (SecureStorageUnavailable)', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const store = new DesktopSessionStore(dir, encryptor)
        await store.Save({ Console: session, Platform: platform })
        encryptor.Available = false
        const failure = await store.Load().then(() => undefined, (e: unknown) => e)
        expect(failure).toBeInstanceOf(AccountError)
        expect((failure as AccountError).Kind).toBe(AccountErrorKind.SecureStorageUnavailable)
    })
})
