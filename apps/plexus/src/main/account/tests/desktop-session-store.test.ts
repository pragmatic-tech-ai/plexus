import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DesktopSessionStore, type DesktopSession, type ITokenEncryptor } from '../desktop-session-store.js'

class ReverseEncryptor implements ITokenEncryptor
{
    public constructor(public Available = true)
    {
    }

    public IsAvailable(): boolean { return this.Available }
    public Encrypt(plain: string): Buffer { return Buffer.from([...plain].reverse().join('')) }
    public Decrypt(blob: Buffer): string { return [...blob.toString()].reverse().join('') }
}

describe('DesktopSessionStore', () =>
{
    const session: DesktopSession = {
        ConsoleUrl: 'https://console-acme.example', Token: 'plain-token-123', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2026-11-11T00:00:00.000Z',
    }
    const legacy = { Token: 'plain-token-123', Email: 'ada@acme.example', TenantId: 't1', TenantName: 'Acme', ExpiresAt: '2026-11-11T00:00:00.000Z' }
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'desktop-session-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it('round-trips the session as one encrypted file and never writes the token in plaintext', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        await store.Save(session)
        expect(await store.Load()).toEqual(session)
        expect(readdirSync(dir)).toEqual(['desktop-session.bin'])
        expect(readFileSync(join(dir, 'desktop-session.bin')).toString()).not.toContain('plain-token-123')
    })

    it('loads undefined when nothing is stored, and after Clear', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor())
        expect(await store.Load()).toBeUndefined()
        await store.Save(session)
        await store.Clear()
        expect(await store.Load()).toBeUndefined()
        await store.Clear()
        expect(readdirSync(dir)).toEqual([])
    })

    it('treats an unreadable file as signed out', async () =>
    {
        writeFileSync(join(dir, 'desktop-session.bin'), 'garbage')
        expect(await new DesktopSessionStore(dir, new ReverseEncryptor()).Load()).toBeUndefined()
    })

    it('refuses to save when secure storage is unavailable, with the SecureStorageUnavailable kind', async () =>
    {
        const store = new DesktopSessionStore(dir, new ReverseEncryptor(false))
        expect(store.CanStore()).toBe(false)
        await expect(store.Save(session)).rejects.toEqual(new AccountError(AccountErrorKind.SecureStorageUnavailable))
        await expect(store.Save(session)).rejects.toBeInstanceOf(AccountError)
        expect(readdirSync(dir)).toEqual([])
    })

    it('Load maps a legacy TenantPlaneUrl blob to ConsoleUrl', async () =>
    {
        const encryptor = new ReverseEncryptor()
        writeFileSync(join(dir, 'desktop-session.bin'), encryptor.Encrypt(JSON.stringify({ TenantPlaneUrl: 'http://127.0.0.1:7002', ...legacy })))
        expect(await new DesktopSessionStore(dir, encryptor).Load()).toEqual({ ConsoleUrl: 'http://127.0.0.1:7002', ...legacy })
    })

    it('Save writes only the new fields', async () =>
    {
        const encryptor = new ReverseEncryptor()
        await new DesktopSessionStore(dir, encryptor).Save({ ...session, TenantPlaneUrl: 'http://127.0.0.1:7002' } as DesktopSession)
        const written = JSON.parse(encryptor.Decrypt(readFileSync(join(dir, 'desktop-session.bin')))) as Record<string, unknown>
        expect(written['ConsoleUrl']).toBe('https://console-acme.example')
        expect(Object.keys(written)).not.toContain('TenantPlaneUrl')
        expect(Object.keys(written).sort()).toEqual(['ConsoleUrl', 'Email', 'ExpiresAt', 'TenantId', 'TenantName', 'Token'])
    })

    it('a blob with neither address reads as signed out', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const store = new DesktopSessionStore(dir, encryptor)
        writeFileSync(join(dir, 'desktop-session.bin'), encryptor.Encrypt(JSON.stringify(legacy)))
        expect(await store.Load()).toBeUndefined()
        writeFileSync(join(dir, 'desktop-session.bin'), encryptor.Encrypt(JSON.stringify({ ConsoleUrl: '', TenantPlaneUrl: '', ...legacy })))
        expect(await store.Load()).toBeUndefined()
    })

    it('CanStore follows the encryptor', () =>
    {
        expect(new DesktopSessionStore(dir, new ReverseEncryptor()).CanStore()).toBe(true)
    })

    it('a stored session cannot be read once secure storage is unavailable (SecureStorageUnavailable)', async () =>
    {
        const encryptor = new ReverseEncryptor()
        const store = new DesktopSessionStore(dir, encryptor)
        await store.Save(session)
        encryptor.Available = false
        const failure = await store.Load().then(() => undefined, (e: unknown) => e)
        expect(failure).toBeInstanceOf(AccountError)
        expect((failure as AccountError).Kind).toBe(AccountErrorKind.SecureStorageUnavailable)
    })
})
