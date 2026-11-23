import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { E2eStackInputs } from '../e2e-stack-inputs'
import { ScriptedRealmSignIn } from '../scripted-realm-sign-in'

class RealmFx
{
    public static readonly Issuer = 'https://host.docker.internal:7300/realms/e2e'

    public static Authorize(overrides: Record<string, string | undefined> = {}, issuer: string = RealmFx.Issuer): string
    {
        const url = new URL(issuer + '/protocol/openid-connect/auth')
        const params: Record<string, string | undefined> = {
            response_type: 'code', client_id: 'plexus', redirect_uri: 'http://127.0.0.1:53111/pragmatic-desktop/callback',
            scope: 'openid email profile offline_access', state: 's', nonce: 'n', code_challenge: 'c', code_challenge_method: 'S256', ...overrides,
        }
        for (const [name, value] of Object.entries(params))
        {
            if (value !== undefined) url.searchParams.set(name, value)
        }
        return url.toString()
    }
}

describe('ScriptedRealmSignIn', () => {
    let dir: string
    let stackFile: string

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'realm-stack-'))
        stackFile = path.join(dir, 'stack.json')
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    it('reads the realm leg from a realm stack, its CA bundle resolved beside stack.json', () => {
        writeFileSync(stackFile, JSON.stringify({ signIn: 'realm', realmIssuer: RealmFx.Issuer, desktopCaFile: 'desktop-ca.pem' }))
        const realm = ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })
        expect(realm?.Issuer).toBe(RealmFx.Issuer)
        expect(realm?.CaBundleFile).toBe(path.resolve(dir, 'desktop-ca.pem'))
        const env: NodeJS.ProcessEnv = {}
        realm!.TrustFor(env)
        expect(env.NODE_EXTRA_CA_CERTS).toBe(path.resolve(dir, 'desktop-ca.pem'))
    })

    it('is absent for a transitional stack or none, and refuses a realm stack without its issuer or bundle', () => {
        writeFileSync(stackFile, JSON.stringify({ signIn: 'transitional' }))
        expect(ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })).toBeUndefined()
        expect(ScriptedRealmSignIn.FromEnvironment({})).toBeUndefined()
        writeFileSync(stackFile, JSON.stringify({ signIn: 'realm', desktopCaFile: 'desktop-ca.pem' }))
        expect(() => ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })).toThrow(/realm issuer/)
        writeFileSync(stackFile, JSON.stringify({ signIn: 'realm', realmIssuer: RealmFx.Issuer }))
        expect(() => ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })).toThrow(/CA bundle/)
    })

    it('accepts the realm authorize request for plexus and refuses anything else', () => {
        writeFileSync(stackFile, JSON.stringify({ signIn: 'realm', realmIssuer: RealmFx.Issuer, desktopCaFile: 'desktop-ca.pem' }))
        const realm = ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })!
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize())).not.toThrow()
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({}, 'https://host.docker.internal:7300/realms/other'))).toThrow(/authorization endpoint/)
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({ client_id: 'pragmatic-desktop' }))).toThrow(/another client/)
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({ code_challenge_method: undefined }))).toThrow(/S256/)
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({ scope: 'openid email' }))).toThrow(/offline_access/)
    })
})
