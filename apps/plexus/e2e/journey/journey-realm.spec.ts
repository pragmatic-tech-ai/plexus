// Journey realm-native deploy e2e (pragmatic-e2e stage F, legs 8/9 — C5.1 (b)): drives the REAL Plexus
// Electron app against a LIVE Hosted hive. The central registered customer identity signs in realm-native
// (platform discovery → the hosted console names its tenant realm → Plexus authorizes at that realm as the
// public client `plexus`), then contributes a TODL sample project's graph to the pre-existing environment
// named by PLEXUS_JOURNEY_ENVIRONMENT (created already by the pragmatic-e2e StaffSignIn leg's env-push).
//
// This is the realm-native half of the proof; the independent read-back (the environment lists the deployed
// graph, queried through the tenant-api as the owner) is pragmatic-e2e's DeployGraphsLeg (leg 9). So this
// spec's assertions are: the sign-in ran at the realm (ScriptedRealmSignIn.CheckAuthorizeUrl — a console-
// brokered/transitional path fails here), and the contribute landed packages in the environment's graph.
//
// Gated by SP_JOURNEY_E2E=1 and a configured scripted sign-in. It is run by pragmatic-e2e's PlexusLeg under
// xvfb on the hive; it needs a built Plexus (out/main/index.js) and the realm inputs the leg passes
// (PLEXUS_E2E_SIGN_IN=realm, PLEXUS_E2E_REALM_ISSUER, PLEXUS_E2E_DESKTOP_CA_FILE, the owner email + password
// file, the platform address). The app runs on an isolated temporary profile, removed afterwards; the
// session the run creates is signed out before the app closes. No account password is ever logged.
import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { launchPlexus, MAIN, ELECTRON_EXE, type Launched } from '../plexus-app'
import { NorthwindFixture } from '../fixtures/fixture-manifest'
import { ScriptedDesktopSignIn } from '../scripted-desktop-sign-in'
import { ScriptedRealmSignIn } from '../support/scripted-realm-sign-in'
import { E2eProfile } from '../support/e2e-profile'

// Result of resolving + driving the real Contribute-to-graph command on the Solution row.
interface ContributeOutcome
{
    ok: boolean
    stage?: string
    packageCount?: number
}

// Renderer-side operations: each reaches the live app's service container via the mural visual backref
// (identical to runtime-live-loop.spec.ts) and drives a real contributor inside the renderer.
class RendererOps
{
    private static readonly VisualBackref = 'mural:visual-backref'
    private static readonly HelpersKey = '__journeyHelpers'
    private static readonly RegistryName = 'HierarchyContributorRegistry'
    private static readonly ContributeContributorName = 'ContributeToGraphContributor'
    private static readonly SolutionFamily = 'solution'
    private static readonly StageResolve = 'resolve'
    private static readonly StageContributorMissing = 'contributor-missing'
    private static readonly ResolveTimeoutMs = 60_000
    private static readonly PollMs = 500

    // Installs the shared browser-side helpers on `window` once (findRoot + services + byCtor), so the
    // operation evaluates below share a single copy of the mural service-container walk.
    public static async InstallHelpers(win: Page): Promise<void>
    {
        await win.evaluate(
            ({ helpersKey, backref }) => {
                const S = Symbol.for(backref)
                ;(window as any)[helpersKey] = {
                    findRoot()
                    {
                        for (const el of document.querySelectorAll('*'))
                        {
                            const v = (el as any)[S]
                            if (v && v.Services) return v
                        }
                        return undefined
                    },
                    services(root: any)
                    {
                        const map: Record<string, any> = {}
                        for (let p = root?.Services; p; p = p._parent)
                        {
                            for (const [, e] of (p._cache ?? new Map()))
                            {
                                const n = (e as any)?.constructor?.name
                                if (n && !(n in map)) map[n] = e
                            }
                        }
                        return map
                    },
                    byCtor(list: any[], name: string)
                    {
                        return (list ?? []).find((c) => c?.constructor?.name === name)
                    },
                }
            },
            { helpersKey: RendererOps.HelpersKey, backref: RendererOps.VisualBackref },
        )
    }

    // Builds the whole active solution's packages and contributes them to the environment's graph through the
    // real IGraphContributor (the console relay, with the app's signed-in realm session) — the exact path the
    // Solution row's "Contribute to graph" command runs (minus the target picker), so the environment goes as
    // a console target ({ Name, Source }), never a bare name.
    public static async Contribute(win: Page, environment: string, graphName: string): Promise<ContributeOutcome>
    {
        return win.evaluate(
            async (p) => {
                const H = (window as any)[p.helpersKey]
                const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
                let contrib: any
                const deadline = Date.now() + p.resolveTimeoutMs
                for (;;)
                {
                    const reg = H.services(H.findRoot())[p.registryName]
                    if (reg) contrib = H.byCtor(reg.For(p.solutionFamily) ?? [], p.contributeContributorName)
                    if (contrib) break
                    if (Date.now() > deadline) return { ok: false, stage: p.stageResolve }
                    await sleep(p.pollMs)
                }

                const contributor = contrib.contributor
                const builder = contrib.builder
                const solution = contrib.solution
                if (contributor === undefined || builder === undefined || solution === undefined) return { ok: false, stage: p.stageContributorMissing }
                const packages = [...await builder.Build()]
                const result = await contributor.Contribute(p.target, p.graphName, solution.Name, packages)
                return { ok: true, packageCount: result?.PackageCount }
            },
            {
                helpersKey: RendererOps.HelpersKey, target: { Name: environment, Source: TargetSource.Console } satisfies TargetRef, graphName,
                registryName: RendererOps.RegistryName, solutionFamily: RendererOps.SolutionFamily,
                contributeContributorName: RendererOps.ContributeContributorName,
                stageResolve: RendererOps.StageResolve, stageContributorMissing: RendererOps.StageContributorMissing,
                resolveTimeoutMs: RendererOps.ResolveTimeoutMs, pollMs: RendererOps.PollMs,
            },
        )
    }
}

// Clones a fixture into a throwaway temp dir so the open + contribute never touch the committed corpus.
class FixtureClone
{
    private static readonly ClonePrefix = 'plexus-journey-'

    public readonly Folder: string

    private constructor(folder: string)
    {
        this.Folder = folder
    }

    public static From(sourceFolder: string): FixtureClone
    {
        const folder = mkdtempSync(path.join(tmpdir(), FixtureClone.ClonePrefix))
        cpSync(sourceFolder, folder, { recursive: true })
        return new FixtureClone(folder)
    }

    public Dispose(): void
    {
        try { rmSync(this.Folder, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
    }
}

const GateEnv = 'SP_JOURNEY_E2E'
const GateValue = '1'
const EnvironmentEnv = 'PLEXUS_JOURNEY_ENVIRONMENT'
// The env realm's sign-in address: Plexus signs in there directly (the console names its own tenant realm),
// bypassing platform email→tenant discovery, which does not resolve a hosted tenant.
const ConsoleAddressEnv = 'PLEXUS_JOURNEY_CONSOLE_ADDRESS'
// The headless xvfb session has no OS keyring; this Electron/Chromium switch makes safeStorage available.
const PasswordStoreBasicArg = '--password-store=basic'
const GraphName = 'journey-graph'

test.describe('journey realm-native deploy', () => {
    test.skip(process.env[GateEnv] !== GateValue, `set ${GateEnv}=${GateValue} to run`)
    test.skip(!ScriptedDesktopSignIn.IsConfigured(), ScriptedDesktopSignIn.SkipMessage)
    test.setTimeout(600_000)

    test('the staff account signs in realm-native and deploys a graph to the journey environment', async () => {
        expect(existsSync(MAIN), `built app missing at ${MAIN} — run npm run build`).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), 'electron binary missing').toBeTruthy()
        const environment = process.env[EnvironmentEnv]
        expect(environment, `${EnvironmentEnv} must name the environment to deploy to`).toBeTruthy()
        // The journey always runs realm mode; FromEnvironment returns undefined for a transitional stack.
        const realm = ScriptedRealmSignIn.FromEnvironment()
        expect(realm, 'realm sign-in must be configured (PLEXUS_E2E_SIGN_IN=realm + issuer + desktop CA)').toBeTruthy()

        const signIn = ScriptedDesktopSignIn.FromEnvironment()
        const clone = FixtureClone.From(NorthwindFixture.folder)
        let profile: E2eProfile | undefined
        let l: Launched | undefined
        try
        {
            const isolated = E2eProfile.Create()
            profile = isolated
            isolated.SeedSession([clone.Folder])
            // Realm mode: the app (only) trusts the stack's CA bundle through NODE_EXTRA_CA_CERTS.
            // --password-store=basic: the headless xvfb session has no OS keyring, so Electron safeStorage
            // (which encrypts the stored RealmGrant) reports unavailable; the basic backend makes it
            // available so the sign-in can be kept (the session is signed out + the profile deleted after).
            l = await launchPlexus(isolated, realm!.LaunchEnv(process.env), [PasswordStoreBasicArg])
            await RendererOps.InstallHelpers(l.win)

            // The headless xvfb session has no OS keyring, so Electron selects the basic (plaintext) backend
            // (--password-store=basic) but reports encryption unavailable until the app opts into the plaintext
            // fallback. Call it from the main process before the first encrypt (the sign-in), so the stored
            // RealmGrant can be kept (the session is signed out + the isolated profile deleted afterwards).
            const storage = await l.app.evaluate(({ safeStorage }) => {
                try { (safeStorage as any).setUsePlainTextEncryption?.(true) } catch (e) { /* set already, or unsupported */ }
                let backend = 'no-getter'
                try { backend = (safeStorage as any).getSelectedStorageBackend ? (safeStorage as any).getSelectedStorageBackend() : 'no-getter' }
                catch (e) { backend = 'err:' + String(e) }
                return { available: safeStorage.isEncryptionAvailable(), backend }
            })
            console.log('[journey] safeStorage available=' + storage.available + ' backend=' + storage.backend)

            const consoleAddress = process.env[ConsoleAddressEnv]
            await test.step('realm-native sign-in', async () => {
                await signIn.SignIn(l!.app, l!.win, isolated, consoleAddress ? { ConsoleAddress: consoleAddress } : {})
                // Diagnostic (no secret in an authorize URL): the real realm the hosted console named, so a
                // first live run reveals the exact issuer to pin via PLEXUS_JOURNEY_REALM_ISSUER if the
                // default <idpHost>/realms/<tenant> guess is wrong.
                console.log('[journey] authorize url: ' + (signIn.LastAuthorizeUrl ?? '(none)'))
                // The sign-in must have run at the realm as plexus (a console-brokered fallback fails here).
                realm!.CheckAuthorizeUrl(signIn.LastAuthorizeUrl)
            })

            await test.step('contribute the graph to the journey environment', async () => {
                const contributed = await RendererOps.Contribute(l!.win, environment!, GraphName)
                expect(contributed, `contribute stage: ${contributed.stage ?? ''}`).toMatchObject({ ok: true })
                expect(contributed.packageCount, 'contribute landed zero packages').toBeGreaterThan(0)
            })
        }
        finally
        {
            if (l !== undefined)
            {
                await signIn.SignOut(l.win).catch(() => {})
                await l.app.close().catch(() => {})
            }
            profile?.DisposeQuietly()
            clone.Dispose()
        }
    })
})
