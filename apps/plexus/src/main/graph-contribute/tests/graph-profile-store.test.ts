import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphProfileStore, type ITokenEncryptor } from '../graph-profile-store.js'

class ReverseEncryptor implements ITokenEncryptor
{
    constructor(public Available = true)
    {
    }

    public IsAvailable(): boolean { return this.Available }
    public Encrypt(plain: string): Buffer { return Buffer.from([...plain].reverse().join('')) }
    public Decrypt(blob: Buffer): string { return [...blob.toString()].reverse().join('') }
}

describe('GraphProfileStore', () =>
{
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'graph-profile-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it('round-trips the profile and never writes the token in plaintext', async () =>
    {
        const store = new GraphProfileStore(dir, new ReverseEncryptor())
        await store.Save(' wss://srv ', 'plain-token-123')
        expect(await store.Load()).toEqual({ ServerUrl: 'wss://srv', Token: 'plain-token-123' })
        expect(readdirSync(dir)).toEqual(['graph-profile.bin'])
        expect(readFileSync(join(dir, 'graph-profile.bin')).toString()).not.toContain('plain-token-123')
    })

    it('loads undefined when nothing is stored', async () =>
    {
        expect(await new GraphProfileStore(dir, new ReverseEncryptor()).Load()).toBeUndefined()
    })

    it('rejects an empty URL or an empty token', async () =>
    {
        const store = new GraphProfileStore(dir, new ReverseEncryptor())
        await expect(store.Save('', 't')).rejects.toThrow(/required/)
        await expect(store.Save('wss://x', '')).rejects.toThrow(/required/)
        await expect(store.Save('wss://x', '   ')).rejects.toThrow(/required/)
    })

    it('reports unavailable secure storage on Save and on Load', async () =>
    {
        await expect(new GraphProfileStore(dir, new ReverseEncryptor(false)).Save('wss://x', 't')).rejects.toThrow(/Secure storage is unavailable/)
        const enc = new ReverseEncryptor()
        await new GraphProfileStore(dir, enc).Save('wss://srv', 'tok')
        enc.Available = false
        await expect(new GraphProfileStore(dir, enc).Load()).rejects.toThrow(/Secure storage is unavailable/)
    })

    it('reports a corrupt blob as unreadable without echoing its bytes', async () =>
    {
        writeFileSync(join(dir, 'graph-profile.bin'), 'garbage-bytes-xyz')
        const err = await new GraphProfileStore(dir, new ReverseEncryptor()).Load().catch((e: Error) => e)
        expect((err as Error).message).toMatch(/could not be read/)
        expect((err as Error).message).not.toContain('garbage-bytes-xyz')
        expect((err as Error).message).not.toContain('zyx-setyb-egabrag')
    })

    it('rejects a non-loopback ws:// URL and accepts wss://', async () =>
    {
        const store = new GraphProfileStore(dir, new ReverseEncryptor())
        await expect(store.Save('ws://srv.example.com', 't')).rejects.toThrow(/graph server URL/)
        await expect(store.Save('wss://srv.example.com', 't')).resolves.toBeUndefined()
        await expect(store.Save('ws://localhost:8080', 't')).resolves.toBeUndefined()
    })
})
