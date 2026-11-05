import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeTlsDefaults, SystemTrust, TlsCaStore, TlsFailure, type ITlsDefaults } from '../system-trust.js'

class FakeTls implements ITlsDefaults
{
    public readonly SetCalls: string[][] = []

    public constructor(private readonly Stores: Record<TlsCaStore, string[]>, private readonly FailOn?: TlsCaStore)
    {
    }

    public GetCaCertificates(store: TlsCaStore): string[]
    {
        if (store === this.FailOn)
        {
            throw new TypeError('cannot read store with secret-detail')
        }
        return this.Stores[store]
    }

    public SetDefaultCaCertificates(certs: string[]): void
    {
        this.SetCalls.push(certs)
    }
}

describe('SystemTrust', () =>
{
    afterEach(() => { vi.restoreAllMocks() })

    it('Apply sets the union of default and system certificates once each', () =>
    {
        const tls = new FakeTls({ [TlsCaStore.Default]: ['A', 'B'], [TlsCaStore.System]: ['B', 'C'] })

        expect(SystemTrust.Apply(tls)).toBe(true)
        expect(tls.SetCalls).toEqual([['A', 'B', 'C']])
    })

    it('Apply changes nothing when the system store cannot be read', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const tls = new FakeTls({ [TlsCaStore.Default]: ['A'], [TlsCaStore.System]: [] }, TlsCaStore.System)

        expect(SystemTrust.Apply(tls)).toBe(false)
        expect(tls.SetCalls).toEqual([])
        expect(warn).toHaveBeenCalledTimes(1)
        const logged = warn.mock.calls[0].map(String).join(' ')
        expect(logged).toContain('TypeError')
        expect(logged).not.toContain('secret-detail')
    })

    it('NodeTlsDefaults reads the real system store', () =>
    {
        expect(new NodeTlsDefaults().GetCaCertificates(TlsCaStore.System).length).toBeGreaterThan(0)
    })
})

describe('TlsFailure', () =>
{
    it('IsCertificate recognises fetch and ws certificate failures', () =>
    {
        expect(TlsFailure.IsCertificate(Object.assign(new TypeError('fetch failed'), { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }))).toBe(true)
        expect(TlsFailure.IsCertificate(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }))).toBe(true)
        expect(TlsFailure.IsCertificate(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(false)
        expect(TlsFailure.IsCertificate('text')).toBe(false)
        expect(TlsFailure.IsCertificate(undefined)).toBe(false)
    })
})
