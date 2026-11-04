import { describe, expect, it } from 'vitest'
import { SignInChecks, SignInCheckError } from '../sign-in-checks'

describe('SignInChecks.IsAuthorizeUrl', () => {
    it('accepts an http(s) URL carrying state and code_challenge', () => {
        expect(SignInChecks.IsAuthorizeUrl('https://idp.example.test/authorize?state=s&code_challenge=c&client_id=x')).toBe(true)
        expect(SignInChecks.IsAuthorizeUrl('http://127.0.0.1:7000/authorize?code_challenge=c&state=s')).toBe(true)
    })

    it('rejects other URLs the opener recorded (links, other schemes, missing PKCE params)', () => {
        for (const url of [
            'https://docs.example.test/help',
            'https://idp.example.test/authorize?state=s',
            'https://idp.example.test/authorize?code_challenge=c',
            'mailto:someone@example.test?state=s&code_challenge=c',
            'not a url',
        ])
        {
            expect(SignInChecks.IsAuthorizeUrl(url)).toBe(false)
        }
    })

    it('picks the first authorize URL among the recorded ones', () => {
        const urls = ['https://docs.example.test/help', 'https://idp.example.test/authorize?state=s&code_challenge=c']
        expect(SignInChecks.FirstAuthorizeUrl(urls)).toBe(urls[1])
        expect(SignInChecks.FirstAuthorizeUrl(['https://docs.example.test/help'])).toBeUndefined()
    })
})

describe('SignInChecks.PickTenant', () => {
    const tenants = [{ Id: 't1', DisplayName: 'Acme' }, { Id: 't2', DisplayName: 'Globex' }]

    it('keeps the pre-selected first tenant when none is configured', () => {
        expect(SignInChecks.PickTenant(tenants, undefined)).toBe(0)
    })

    it('matches the configured tenant by id or display name', () => {
        expect(SignInChecks.PickTenant(tenants, 't2')).toBe(1)
        expect(SignInChecks.PickTenant(tenants, 'Acme')).toBe(0)
    })

    it('fails with a fixed sentence when a configured tenant matches nothing', () => {
        expect(() => SignInChecks.PickTenant(tenants, 'Acne')).toThrow(SignInCheckError)
        expect(() => SignInChecks.PickTenant(tenants, 'Acne')).toThrow(/PLEXUS_E2E_TENANT matches none/)
    })
})

describe('SignInChecks.ExistingSessionFault', () => {
    it('refuses a profile that already holds a session instead of signing it out', () => {
        expect(SignInChecks.ExistingSessionFault(false)).toBeUndefined()
        expect(SignInChecks.ExistingSessionFault(true)).toMatch(/already holds a session/)
    })
})
