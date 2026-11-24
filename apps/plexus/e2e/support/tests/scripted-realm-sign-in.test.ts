import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { E2eStackInputs } from '../e2e-stack-inputs'
import { E2eSignInMode, ScriptedRealmSignIn } from '../scripted-realm-sign-in'

class RealmFx
{
    public static readonly Issuer = 'https://host.docker.internal:7300/realms/e2e'
    public static readonly OtherIssuer = 'https://host.docker.internal:7300/realms/other'
    public static readonly CaBundle = 'desktop-ca.pem'
    public static readonly OtherBundle = 'C:/elsewhere/corp-ca.pem'
    public static readonly OtherClient = 'pragmatic-desktop'
    public static readonly NoOfflineScope = 'openid email'
    public static readonly StackFile = 'stack.json'
    public static readonly NoRealm = 'the realm stack read as no realm leg'

    // Writes the stack descriptor `file` with the realm fields given (undefined leaves one out).
    public static WriteStack(file: string, fields: { signIn?: string; realmIssuer?: string; desktopCaFile?: string }): void
    {
        writeFileSync(file, JSON.stringify(fields))
    }

    public static RealmStack(file: string): void
    {
        RealmFx.WriteStack(file, { signIn: E2eSignInMode.Realm, realmIssuer: RealmFx.Issuer, desktopCaFile: RealmFx.CaBundle })
    }

    public static Authorize(overrides: Record<string, string | undefined> = {}, issuer: string = RealmFx.Issuer): string
    {
        const url = new URL(issuer + ScriptedRealmSignIn.AuthorizeSuffix)
        const params: Record<string, string | undefined> = {
            response_type: 'code', client_id: ScriptedRealmSignIn.ClientId, redirect_uri: 'http://127.0.0.1:53111/pragmatic-desktop/callback',
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
        stackFile = path.join(dir, RealmFx.StackFile)
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    const realmOf = (): ScriptedRealmSignIn => {
        RealmFx.RealmStack(stackFile)
        const realm = ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })
        if (realm === undefined) throw new Error(RealmFx.NoRealm)
        return realm
    }

    it('reads the realm leg from a realm stack, its CA bundle resolved beside stack.json', () => {
        const realm = realmOf()
        expect(realm.Issuer).toBe(RealmFx.Issuer)
        expect(realm.CaBundleFile).toBe(path.resolve(dir, RealmFx.CaBundle))
    })

    it('launches the app trusting the bundle without changing the runner environment', () => {
        const realm = realmOf()
        const env: NodeJS.ProcessEnv = {}
        expect(realm.LaunchEnv(env)).toEqual({ [ScriptedRealmSignIn.CaEnv]: path.resolve(dir, RealmFx.CaBundle) })
        expect(env).toEqual({})
        const already: NodeJS.ProcessEnv = { [ScriptedRealmSignIn.CaEnv]: realm.CaBundleFile }
        expect(realm.LaunchEnv(already)).toEqual({ [ScriptedRealmSignIn.CaEnv]: realm.CaBundleFile })
    })

    it('refuses a different bundle already set, leaving it untouched', () => {
        const realm = realmOf()
        const env: NodeJS.ProcessEnv = { [ScriptedRealmSignIn.CaEnv]: RealmFx.OtherBundle }
        expect(() => realm.LaunchEnv(env)).toThrow(/already set to another bundle/)
        expect(env[ScriptedRealmSignIn.CaEnv]).toBe(RealmFx.OtherBundle)
    })

    it('is absent for a transitional stack or none, and refuses a realm stack without its issuer or bundle', () => {
        RealmFx.WriteStack(stackFile, { signIn: E2eSignInMode.Transitional })
        expect(ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })).toBeUndefined()
        expect(ScriptedRealmSignIn.FromEnvironment({})).toBeUndefined()
        RealmFx.WriteStack(stackFile, { signIn: E2eSignInMode.Realm, desktopCaFile: RealmFx.CaBundle })
        expect(() => ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })).toThrow(/realm issuer/)
        RealmFx.WriteStack(stackFile, { signIn: E2eSignInMode.Realm, realmIssuer: RealmFx.Issuer })
        expect(() => ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })).toThrow(/CA bundle/)
    })

    it('accepts the realm authorize request for plexus and refuses anything else', () => {
        const realm = realmOf()
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize())).not.toThrow()
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({}, RealmFx.OtherIssuer))).toThrow(/authorization endpoint/)
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({ client_id: RealmFx.OtherClient }))).toThrow(/another client/)
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({ code_challenge_method: undefined }))).toThrow(/S256/)
        expect(() => realm.CheckAuthorizeUrl(RealmFx.Authorize({ scope: RealmFx.NoOfflineScope }))).toThrow(/offline_access/)
    })

    it('names a missing authorize URL, and compares the endpoint as a URL (a trailing slash or a default port is the same realm)', () => {
        const realm = realmOf()
        expect(() => realm.CheckAuthorizeUrl(undefined)).toThrow(/no authorize URL was opened/)
        expect(() => realm.CheckAuthorizeUrl('')).toThrow(/no authorize URL was opened/)
        RealmFx.WriteStack(stackFile, { signIn: E2eSignInMode.Realm, realmIssuer: 'https://idp.example:443/realms/e2e/', desktopCaFile: RealmFx.CaBundle })
        const slashed = ScriptedRealmSignIn.FromEnvironment({ [E2eStackInputs.StackEnv]: stackFile })
        expect(() => slashed?.CheckAuthorizeUrl(RealmFx.Authorize({}, 'https://idp.example/realms/e2e'))).not.toThrow()
    })
})
