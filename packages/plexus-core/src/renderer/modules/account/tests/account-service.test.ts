import { describe, expect, it } from 'vitest'
import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import { AccountServiceKey, SignInRequest } from '../index.js'

describe('AccountServiceKey', () =>
{
    it('is a service key named AccountService', () =>
    {
        expect(AccountServiceKey.description).toBe('AccountService')
    })
})

describe('SignInRequest', () =>
{
    it('resolves false at once when nobody accepts it', async () =>
    {
        const signal = new Signal<SignInRequest>()
        await expect(SignInRequest.Raise(signal)).resolves.toBe(false)
    })

    it('resolves with what the accepting listener completes it with, once', async () =>
    {
        const signal = new Signal<SignInRequest>()
        let held: SignInRequest | undefined
        signal.subscribe((r) => { r.Accept(); held = r })
        const done = SignInRequest.Raise(signal)
        expect(held!.IsCompleted).toBe(false)
        held!.Complete(true)
        held!.Complete(false)
        await expect(done).resolves.toBe(true)
    })
})
