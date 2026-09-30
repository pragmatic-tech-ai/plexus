import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectionTokenStore } from '../connection-token-store.js'
import type { Encryptor } from '../encryptor.js'

// A reversible fake Encryptor (identity round-trip) standing in for safeStorage, so
// the store's read/write path runs with no Electron. `available` gates disk writes.
class FakeEncryptor implements Encryptor
{
    constructor(private readonly available: boolean) {}
    public IsAvailable(): boolean { return this.available }
    public Encrypt(plain: string): Buffer { return Buffer.from(plain, 'utf8') }
    public Decrypt(blob: Buffer): string { return blob.toString('utf8') }
}

describe('ConnectionTokenStore', () =>
{
    it('round-trips a token to <userData>/conn-token-<id>.bin (byte-compat layout)', () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new ConnectionTokenStore(dir, new FakeEncryptor(true))
        store.SetToken('npm-public', 'secret')
        expect(readdirSync(dir)).toContain('conn-token-npm-public.bin')
        expect(store.HasToken('npm-public')).toBe(true)
        expect(store.GetToken('npm-public')).toBe('secret')
    })

    it('reads a token file written in the exact devUI on-disk layout', () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        // Simulate a file written by pre-promotion devUI (same FakeEncryptor bytes).
        writeFileSync(join(dir, 'conn-token-legacy.bin'), Buffer.from('carried-over', 'utf8'))
        const store = new ConnectionTokenStore(dir, new FakeEncryptor(true))
        expect(store.HasToken('legacy')).toBe(true)
        expect(store.GetToken('legacy')).toBe('carried-over')
    })

    it('when the encryptor is unavailable, keeps tokens in memory and writes NO plaintext file', () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new ConnectionTokenStore(dir, new FakeEncryptor(false))
        store.SetToken('x', 'secret')
        expect(store.GetToken('x')).toBe('secret')                      // session memory
        expect(existsSync(join(dir, 'conn-token-x.bin'))).toBe(false)   // never plaintext
    })

    it('Clear removes both the in-memory and on-disk token', () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new ConnectionTokenStore(dir, new FakeEncryptor(true))
        store.SetToken('y', 'secret')
        store.Clear('y')
        expect(store.HasToken('y')).toBe(false)
        expect(existsSync(join(dir, 'conn-token-y.bin'))).toBe(false)
    })
})
