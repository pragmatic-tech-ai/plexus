import { describe, it, expect } from 'vitest'
import { AccountError, AccountErrorKind, AccountWire, PlatformAddress, RelayError, RelayWire } from '../account-api.js'

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
        expect(new AccountError(AccountErrorKind.InvalidEmail).message).toBe("That doesn't look like an email address.")
        for (const kind of Object.values(AccountErrorKind))
        {
            expect(new AccountError(kind).message.length).toBeGreaterThan(0)
        }
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

    it('turns any other error into Unavailable without its message, handing it to onUnexpected first', async () =>
    {
        const unexpected: unknown[] = []
        const failure = new Error('C:\\secret\\path token=abc')
        const reply = await AccountWire.Capture(async () => { throw failure }, e => unexpected.push(e))
        expect(reply).toEqual({ Ok: false, Error: { Kind: AccountErrorKind.Unavailable } })
        expect(JSON.stringify(reply)).not.toContain('abc')
        expect(unexpected).toEqual([failure])
        await AccountWire.Capture(async () => { throw new AccountError(AccountErrorKind.NoAccount) }, e => unexpected.push(e))
        expect(unexpected).toHaveLength(1)
    })

    it('round-trips through a structured clone (the IPC and context-bridge copy) for every kind', async () =>
    {
        const ok = structuredClone(await AccountWire.Capture(async () => ({ SignedIn: true, Email: 'a@b.c' })))
        expect(AccountWire.Unwrap(ok)).toEqual({ SignedIn: true, Email: 'a@b.c' })
        for (const kind of Object.values(AccountErrorKind))
        {
            const reply = structuredClone(await AccountWire.Capture(async () => { throw new AccountError(kind) }))
            expect(reply).toEqual({ Ok: false, Error: { Kind: kind } })
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
            expect((caught as AccountError).Kind).toBe(kind)
        }
    })

    it('rebuilds an unknown wire kind as Unavailable', () =>
    {
        let caught: unknown
        try
        {
            AccountWire.Unwrap({ Ok: false, Error: { Kind: 'bogus' as AccountErrorKind } })
        }
        catch (e)
        {
            caught = e
        }
        expect((caught as AccountError).Kind).toBe(AccountErrorKind.Unavailable)
    })
})

describe('RelayWire', () =>
{
    it('wraps a value and unwraps it', async () =>
    {
        const reply = await RelayWire.Capture(async () => ['main'])
        expect(reply).toEqual({ Ok: true, Value: ['main'] })
        expect(RelayWire.Unwrap(reply)).toEqual(['main'])
    })

    it('carries an error as its sentence and rebuilds a plain Error', async () =>
    {
        const reply = await RelayWire.Capture(async () => { throw new Error('The environment dev could not be reached.') })
        expect(reply).toEqual({ Ok: false, Error: { Message: 'The environment dev could not be reached.' } })
        const error = (() => { try { RelayWire.Unwrap(reply) } catch (e) { return e as Error } })()
        expect(error).toBeInstanceOf(RelayError)
        expect(error).not.toBeInstanceOf(AccountError)
        expect(error!.message).toBe('The environment dev could not be reached.')
    })

    it('keeps an account error kind across the wire', async () =>
    {
        const reply = await RelayWire.Capture(async () => { throw new AccountError(AccountErrorKind.SignedOut) })
        expect(reply).toEqual({ Ok: false, Error: { Message: "You're signed out. Sign in and try again.", Kind: AccountErrorKind.SignedOut } })
        const error = (() => { try { RelayWire.Unwrap(reply) } catch (e) { return e as AccountError } })()
        expect(error).toBeInstanceOf(AccountError)
        expect(error!.Kind).toBe(AccountErrorKind.SignedOut)
    })

    it('answers a non-Error failure with a fixed sentence', async () =>
    {
        const reply = await RelayWire.Capture(async () => { throw 'secret text' })
        expect(reply.Ok).toBe(false)
        expect(JSON.stringify(reply)).not.toContain('secret text')
    })
})
