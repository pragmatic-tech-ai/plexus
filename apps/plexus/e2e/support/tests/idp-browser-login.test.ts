import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { IdpBrowserLogin } from '../idp-browser-login'

describe('IdpBrowserLogin.SpkiPinFromPemFile', () => {
    it('computes the base64 SHA-256 of the certificate public key (SPKI DER)', () => {
        const pin = IdpBrowserLogin.SpkiPinFromPemFile(join(__dirname, 'fixtures', 'pin-fixture.pem'))
        // Cross-checked with: openssl x509 -pubkey | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
        expect(pin).toBe('KJPHZ+ZGcRTx2lIYIa7YXpxlWpw3HqfczuAmBFZnCrA=')
    })
})

describe('IdpBrowserLogin.LaunchOptionsFor', () => {
    it('adds the pin flag only when pins are given, and never ignores HTTPS errors', () => {
        expect(IdpBrowserLogin.LaunchOptionsFor([]).args ?? []).toEqual([])
        const options = IdpBrowserLogin.LaunchOptionsFor(['a=', 'b='])
        expect(options.args).toEqual(['--ignore-certificate-errors-spki-list=a=,b='])
        expect(options.headless).toBe(true)
    })
})

describe('IdpBrowserLogin.IsCallback', () => {
    it('accepts the Plexus loopback callback on any loopback host and port, with or without a query', () => {
        expect(IdpBrowserLogin.IsCallback(new URL('http://127.0.0.1:53211/pragmatic-desktop/callback?code=c&state=s'))).toBe(true)
        expect(IdpBrowserLogin.IsCallback(new URL('http://localhost:1/pragmatic-desktop/callback'))).toBe(true)
        expect(IdpBrowserLogin.IsCallback(new URL('http://[::1]:2/pragmatic-desktop/callback'))).toBe(true)
    })

    it('rejects the IdP pages, other paths, other hosts and https', () => {
        for (const url of [
            'https://idp-pragmatic-default.localtest.me/pragmatic-default/authorize',
            'http://127.0.0.1:53211/other',
            'http://127.0.0.1:53211/pragmatic-desktop/callback/extra',
            'http://example.test/pragmatic-desktop/callback',
            'https://127.0.0.1:53211/pragmatic-desktop/callback',
        ])
        {
            expect(IdpBrowserLogin.IsCallback(new URL(url))).toBe(false)
        }
    })
})
