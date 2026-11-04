import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect } from 'node:net'
import { AccountError, AccountErrorKind } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { LoopbackRedirectReceiver } from '../loopback-redirect-receiver.js'

class Probe
{
    // Resolves true when a TCP connect to the port succeeds, false when it is refused.
    public static Accepts(port: number): Promise<boolean>
    {
        return new Promise(resolve =>
        {
            const socket = connect(port, '127.0.0.1')
            socket.once('connect', () => { socket.destroy(); resolve(true) })
            socket.once('error', () => resolve(false))
        })
    }

    public static PortOf(redirectUri: string): number
    {
        return Number(new URL(redirectUri).port)
    }
}

describe('LoopbackRedirectReceiver', () =>
{
    let receiver: LoopbackRedirectReceiver | undefined

    afterEach(async () =>
    {
        vi.useRealTimers()
        await receiver?.Close()
        receiver = undefined
    })

    it('listens on an ephemeral 127.0.0.1 port at the callback path', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        expect(RedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/pragmatic-desktop\/callback$/)
        expect(Probe.PortOf(RedirectUri)).toBeGreaterThan(0)
    })

    it('returns the code for the right state and answers the browser with a plain page', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        const code = receiver.WaitForCode('st-1')
        const res = await fetch(`${RedirectUri}?state=st-1&code=the-code`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toMatch(/text\/html/)
        expect(await res.text()).toContain('You can close this tab and return to Plexus.')
        expect(await code).toBe('the-code')
    })

    it('answers 400 to a mismatched state and keeps waiting', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        const code = receiver.WaitForCode('good')
        const bad = await fetch(`${RedirectUri}?state=bad&code=stolen`)
        expect(bad.status).toBe(400)
        const good = await fetch(`${RedirectUri}?state=good&code=real`)
        expect(good.status).toBe(200)
        expect(await code).toBe('real')
    })

    it('answers 404 to other paths', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        const code = receiver.WaitForCode('s')
        const res = await fetch(new URL('/favicon.ico', RedirectUri))
        expect(res.status).toBe(404)
        await fetch(`${RedirectUri}?state=s&code=c`)
        expect(await code).toBe('c')
    })

    it('fails the sign-in when the browser comes back with an error for our state', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        const code = receiver.WaitForCode('s')
        const outcome = code.catch(e => e)
        const res = await fetch(`${RedirectUri}?state=s&error=access_denied`)
        expect(res.status).toBe(200)
        const e = await outcome
        expect(e).toBeInstanceOf(AccountError)
        expect((e as AccountError).Kind).toBe(AccountErrorKind.SignInFailed)
    })

    it('gives up after 5 minutes and closes the port', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        const port = Probe.PortOf(RedirectUri)
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const outcome = receiver.WaitForCode('s').catch(e => e)
        await vi.advanceTimersByTimeAsync(299_999)
        expect(await Probe.Accepts(port)).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        vi.useRealTimers()
        const e = await outcome
        expect(e).toBeInstanceOf(AccountError)
        expect((e as AccountError).Kind).toBe(AccountErrorKind.TimedOut)
        expect(await Probe.Accepts(port)).toBe(false)
    })

    it('Cancel rejects the wait with Cancelled and closes the port', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        const { RedirectUri } = await receiver.Start()
        const outcome = receiver.WaitForCode('s').catch(e => e)
        receiver.Cancel()
        const e = await outcome
        expect((e as AccountError).Kind).toBe(AccountErrorKind.Cancelled)
        expect(await Probe.Accepts(Probe.PortOf(RedirectUri))).toBe(false)
    })

    it('Close is safe to call repeatedly and before Start', async () =>
    {
        receiver = new LoopbackRedirectReceiver()
        await receiver.Close()
        const { RedirectUri } = await receiver.Start()
        await receiver.Close()
        await receiver.Close()
        expect(await Probe.Accepts(Probe.PortOf(RedirectUri))).toBe(false)
    })
})
