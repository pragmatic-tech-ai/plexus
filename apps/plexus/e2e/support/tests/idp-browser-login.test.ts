import { describe, expect, it } from 'vitest'
import { IdpBrowserLogin } from '../idp-browser-login'

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
