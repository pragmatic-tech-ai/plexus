import { describe, expect, it } from 'vitest'
import { E2eStackInputs } from '../e2e-stack-inputs'

describe('E2eStackInputs.Merge', () => {
    const stack = {
        ownerEmail: 'o@t.io',
        ownerPasswordFile: 'C:/stack/owner-password',
        platformAddress: 'http://localhost:7000',
        tenant: 'e2e',
        idpCaFile: 'C:/stack/ca.crt',
        idpCertFile: 'C:/stack/server.crt',
        idpLogin: 'browser',
        operatorPasswordFile: 'C:/stack/operator-password',
    }

    it('fills the sign-in variables from the stack and nothing else', () => {
        expect(E2eStackInputs.Merge({}, stack)).toEqual({
            PLEXUS_E2E_OWNER_EMAIL: 'o@t.io',
            PLEXUS_E2E_OWNER_PASSWORD_FILE: 'C:/stack/owner-password',
            PLEXUS_E2E_PLATFORM_ADDRESS: 'http://localhost:7000',
            PLEXUS_E2E_TENANT: 'e2e',
            PLEXUS_E2E_IDP_CA_FILE: 'C:/stack/ca.crt',
            PLEXUS_E2E_IDP_CERT_FILE: 'C:/stack/server.crt',
            PLEXUS_E2E_IDP_LOGIN: 'browser',
        })
    })

    it('lets a set variable win and ignores blank ones', () => {
        const merged = E2eStackInputs.Merge({ PLEXUS_E2E_TENANT: 'other', PLEXUS_E2E_OWNER_EMAIL: '  ' }, stack)
        expect(merged.PLEXUS_E2E_TENANT).toBe('other')
        expect(merged.PLEXUS_E2E_OWNER_EMAIL).toBe('o@t.io')
    })

    it('adds nothing when PLEXUS_E2E_STACK names a missing file, so the specs skip instead of erroring', () => {
        const env = { PLEXUS_E2E_STACK: 'C:/no/such/stack.json' }
        expect(E2eStackInputs.Apply(env)).toBe(env)
    })

    it('leaves the environment alone without PLEXUS_E2E_STACK', () => {
        const env = { PLEXUS_E2E_OWNER_EMAIL: 'a@b.c' }
        expect(E2eStackInputs.Apply(env)).toBe(env)
    })
})
