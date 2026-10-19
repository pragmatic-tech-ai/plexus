import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TenantProfileStore, type ITokenEncryptor } from '../tenant-profile-store.js'

class ReverseEncryptor implements ITokenEncryptor
{
    constructor(private readonly available = true)
    {
    }

    public IsAvailable(): boolean { return this.available }
    public Encrypt(plain: string): Buffer { return Buffer.from([...plain].reverse().join('')) }
    public Decrypt(blob: Buffer): string { return [...blob.toString()].reverse().join('') }
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
        for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f)).toString()).not.toContain('plain-token-123')
    })

    it('loads undefined when nothing is stored', async () =>
    {
        expect(await new TenantProfileStore(dir, new ReverseEncryptor()).Load()).toBeUndefined()
    })

    it('refuses to save when secure storage is unavailable or the input is empty', async () =>
    {
        await expect(new TenantProfileStore(dir, new ReverseEncryptor(false)).Save('wss://x', 't')).rejects.toThrow(/Secure storage/)
        await expect(new TenantProfileStore(dir, new ReverseEncryptor()).Save('', 't')).rejects.toThrow(/required/)
    })
})
