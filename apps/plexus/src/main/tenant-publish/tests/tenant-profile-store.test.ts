import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TenantProfileStore, type ITokenEncryptor } from '../tenant-profile-store.js'

class ReverseEncryptor implements ITokenEncryptor
{
    constructor(public Available = true)
    {
    }

    public IsAvailable(): boolean { return this.Available }
    public Encrypt(plain: string): Buffer { return Buffer.from([...plain].reverse().join('')) }
    public Decrypt(blob: Buffer): string { return [...blob.toString()].reverse().join('') }
}

class ThrowingEncryptor extends ReverseEncryptor
{
    public override Decrypt(): string { throw new Error('bad blob plain-token-123') }
}

describe('TenantProfileStore', () =>
{
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tenant-profile-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it('round-trips the profile and never writes the token in plaintext', async () =>
    {
        const store = new TenantProfileStore(dir, new ReverseEncryptor())
        await store.Save(' wss://srv ', 'plain-token-123')
        expect(await store.Load()).toEqual({ ServerUrl: 'wss://srv', Token: 'plain-token-123' })
        expect(readdirSync(dir)).toEqual(['tenant-profile.bin'])
        for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f)).toString()).not.toContain('plain-token-123')
    })

    it('loads undefined when nothing is stored', async () =>
    {
        expect(await new TenantProfileStore(dir, new ReverseEncryptor()).Load()).toBeUndefined()
    })

    it('refuses to save when secure storage is unavailable, the input is empty, or the URL is cleartext', async () =>
    {
        await expect(new TenantProfileStore(dir, new ReverseEncryptor(false)).Save('wss://x', 't')).rejects.toThrow(/Secure storage/)
        await expect(new TenantProfileStore(dir, new ReverseEncryptor()).Save('', 't')).rejects.toThrow(/required/)
        await expect(new TenantProfileStore(dir, new ReverseEncryptor()).Save('ws://srv.example.com', 't')).rejects.toThrow(/cleartext/)
    })

    it('reports unavailable secure storage on load distinctly from no profile', async () =>
    {
        const enc = new ReverseEncryptor()
        await new TenantProfileStore(dir, enc).Save('wss://srv', 'tok')
        enc.Available = false
        await expect(new TenantProfileStore(dir, enc).Load()).rejects.toThrow(/Secure storage is unavailable/)
    })

    it('wraps an unreadable blob in a clear error that does not leak content', async () =>
    {
        await new TenantProfileStore(dir, new ReverseEncryptor()).Save('wss://srv', 'plain-token-123')
        const err = await new TenantProfileStore(dir, new ThrowingEncryptor()).Load().catch((e: Error) => e)
        expect((err as Error).message).toMatch(/could not be read/)
        expect((err as Error).message).not.toContain('plain-token-123')
        writeFileSync(join(dir, 'tenant-profile.bin'), 'garbage')
        await expect(new TenantProfileStore(dir, new ReverseEncryptor()).Load()).rejects.toThrow(/could not be read/)
    })
})
