import { describe, expect, it } from 'vitest'
import { AccountServiceKey } from '../index.js'

describe('AccountServiceKey', () =>
{
    it('is a service key named AccountService', () =>
    {
        expect(AccountServiceKey.description).toBe('AccountService')
    })
})
