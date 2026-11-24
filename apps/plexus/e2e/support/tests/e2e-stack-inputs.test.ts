import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

    it('fills the realm leg\'s variables from a realm stack (E.s S9), its CA bundle resolved like the other files', () => {
        const realm = { ...stack, signIn: 'realm', realmIssuer: 'https://host.docker.internal:7300/realms/e2e', desktopCaFile: 'C:/stack/desktop-ca.pem' }
        const merged = E2eStackInputs.Merge({}, realm)
        expect(merged[E2eStackInputs.SignInEnv]).toBe('realm')
        expect(merged[E2eStackInputs.RealmIssuerEnv]).toBe('https://host.docker.internal:7300/realms/e2e')
        expect(merged[E2eStackInputs.DesktopCaFileEnv]).toBe('C:/stack/desktop-ca.pem')
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

    it('resolves the stack\'s relative file paths against its folder (a descriptor written in WSL, read on Windows)', () => {
        const folder = mkdtempSync(path.join(tmpdir(), 'stack-inputs-'))
        try
        {
            const file = path.join(folder, 'stack.json')
            writeFileSync(file, JSON.stringify({ ...stack, ownerPasswordFile: 'owner-password', idpCaFile: 'data/idp/e2e/tls/ca.crt' }))
            const merged = E2eStackInputs.Apply({ PLEXUS_E2E_STACK: file })
            expect(merged.PLEXUS_E2E_OWNER_PASSWORD_FILE).toBe(path.join(folder, 'owner-password'))
            expect(merged.PLEXUS_E2E_IDP_CA_FILE).toBe(path.join(folder, 'data', 'idp', 'e2e', 'tls', 'ca.crt'))
            expect(merged.PLEXUS_E2E_IDP_CERT_FILE).toBe(path.resolve('C:/stack/server.crt'))
            expect(merged.PLEXUS_E2E_PLATFORM_ADDRESS).toBe('http://localhost:7000')
        }
        finally
        {
            rmSync(folder, { recursive: true, force: true })
        }
    })

    it('leaves the environment alone without PLEXUS_E2E_STACK', () => {
        const env = { PLEXUS_E2E_OWNER_EMAIL: 'a@b.c' }
        expect(E2eStackInputs.Apply(env)).toBe(env)
    })
})
