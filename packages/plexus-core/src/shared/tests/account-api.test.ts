import { describe, it, expect } from 'vitest'
import { AccountError, AccountErrorKind, AccountWire, PlatformAddress } from '../account-api.js'

describe('PlatformAddress.Validate', () =>
{
    it('accepts https anywhere and http for localhost', () =>
    {
        expect(PlatformAddress.Validate('http://localhost:7000')).toBeUndefined()
        expect(PlatformAddress.Validate('http://127.0.0.1:7000')).toBeUndefined()
        expect(PlatformAddress.Validate('http://[::1]:7000')).toBeUndefined()
        expect(PlatformAddress.Validate('https://p.example')).toBeUndefined()
        expect(PlatformAddress.Validate(PlatformAddress.Default)).toBeUndefined()
    })

    it('refuses cleartext to a non-loopback host, other schemes and malformed addresses', () =>
    {
        expect(PlatformAddress.Validate('http://p.example')).toMatch(/https/)
        expect(PlatformAddress.Validate('ftp://x')).toMatch(/https/)
        expect(PlatformAddress.Validate('not an address')).toMatch(/not a valid/)
    })
})

describe('AccountError', () =>
{
    it('carries a fixed plain sentence per kind', () =>
    {
        expect(new AccountError(AccountErrorKind.NoAccount).message).toBe('No account was found for this email.')
        expect(new AccountError(AccountErrorKind.Unreachable).message).toBe('The platform could not be reached. Check the Platform address in Settings.')
        expect(new AccountError(AccountErrorKind.TimedOut).message).toBe('Sign-in was not finished in the browser. Try again.')
        expect(new AccountError(AccountErrorKind.SignedOut).message).toBe("You're signed out. Sign in and try again.")
        for (const kind of Object.values(AccountErrorKind))
        {
            expect(new AccountError(kind).message.length).toBeGreaterThan(0)
        }
    })
})

describe('AccountError.From', () =>
{
    it('recovers the kind from an error that kept only the message', () =>
    {
        for (const kind of Object.values(AccountErrorKind))
        {
            const copied = new Error(new AccountError(kind).message)
            expect(AccountError.From(copied)?.Kind).toBe(kind)
        }
        const prefixed = new Error(`Error invoking remote method 'x': ${new AccountError(AccountErrorKind.SignedOut).message}`)
        expect(AccountError.From(prefixed)?.Kind).toBe(AccountErrorKind.SignedOut)
    })

    it('answers the same instance for an AccountError and undefined for anything else', () =>
    {
        const e = new AccountError(AccountErrorKind.NoAccount)
        expect(AccountError.From(e)).toBe(e)
        expect(AccountError.From(new Error('boom'))).toBeUndefined()
        expect(AccountError.From('nope')).toBeUndefined()
    })
})

describe('AccountWire', () =>
{
    it('passes a value through', async () =>
    {
        const reply = await AccountWire.Capture(async () => 42)
        expect(reply).toEqual({ Ok: true, Value: 42 })
        expect(AccountWire.Unwrap(reply)).toBe(42)
    })

    it('carries only the kind of an AccountError and rebuilds it', async () =>
    {
        const reply = await AccountWire.Capture(async () => { throw new AccountError(AccountErrorKind.SignedOut) })
        expect(reply).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.SignedOut } })
        let caught: unknown
        try
        {
            AccountWire.Unwrap(reply)
        }
        catch (e)
        {
            caught = e
        }
        expect(caught).toBeInstanceOf(AccountError)
        expect((caught as AccountError).Kind).toBe(AccountErrorKind.SignedOut)
    })

    it('turns any other error into Unavailable without its message', async () =>
    {
        const reply = await AccountWire.Capture(async () => { throw new Error('C:\\secret\\path token=abc') })
        expect(reply).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(JSON.stringify(reply)).not.toContain('abc')
    })
})
