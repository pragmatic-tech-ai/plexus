// Live smoke: Plexus signs in to an IN-HIVE tenant console and contributes through its relay.
//
// Operator-run against a real cluster (never part of the unit gates). It skips unless every env var
// below is set. Prerequisites (established by the operator before running; see the Task 9 brief):
//   - the console installed on the hive with development TLS, its environment (PLEXUS_IHC_ENVIRONMENT)
//     created and running, and the control plane advertising the console (discovery returns consoleUrl);
//   - the dev CA trusted by the OS store, so Plexus main reaches the console over https with no CA option;
//   - PLEXUS_E2E_IDP_CA_FILE set to the install's devCaFile, so the scripted IdP login (Node https in
//     this test process, which does not use the OS store) trusts the same CA.
//
// Inputs (environment variables, all required):
//   PLEXUS_E2E_PLATFORM_ADDRESS     platform address used by the discovery sign-in (e.g. http://localhost:7000)
//   PLEXUS_E2E_OWNER_EMAIL          the tenant Owner's email
//   PLEXUS_E2E_OWNER_PASSWORD_FILE  path of a file holding the Owner's password (read, never printed)
//   PLEXUS_IHC_CONSOLE_URL          the console address (e.g. https://console-pragmatic-default.localtest.me)
//   PLEXUS_IHC_ENVIRONMENT          the environment created on the console (e.g. smoke-ihd)
// Also read by the helper: PLEXUS_E2E_IDP_CA_FILE (see above).
//
// Secret hygiene: the password lives only inside ScriptedDesktopSignIn. Tracing, screenshots and video
// are disabled for this spec, and no step title or assertion message carries a secret.
//
// Not covered here (the operator does them by hand, outside Plexus): the console's desktop audit file
// check, and the operator Owner reset (POST .../console/owner-password, then Targets() becomes signed out
// within one advert interval of 5 minutes).
import { test, expect, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { launchPlexus, MAIN, ELECTRON_EXE, type Launched } from './plexus-app'
import { ScriptedDesktopSignIn } from './scripted-desktop-sign-in'
import { E2eProfile } from './support/e2e-profile'

// The contribute outcome as the renderer reports it.
interface GraphOutcome
{
    Ok: boolean
    Error?: string
    PackageCount?: number
    Graphs?: string[]
}

// Renderer-side graph operations: reach the GraphContributor service through the mural visual backref
// (the same cache walk the helper uses) and invoke it, i.e. the relay path the app's own commands use.
class RendererGraph
{
    private static readonly VisualBackref = 'mural:visual-backref'
    private static readonly ContributorKey = 'GraphContributor'
    private static readonly ErrorKind = 'Kind'
    private static readonly PollMs = 250
    private static readonly ResolveTimeoutMs = 30_000
    private static readonly NotFound = 'the GraphContributor service was not found'
    private static readonly PackageVersion = '1.0.0'

    // Contributes a one-entity package to the environment's graph, then lists the environment's graphs.
    public static async ContributeAndList(win: Page, environment: string, graphName: string, packageId: string): Promise<GraphOutcome>
    {
        return win.evaluate(async (p) =>
        {
            const backref = Symbol.for(p.backref)
            const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
            const deadline = Date.now() + p.timeoutMs
            let contributor: any
            while (contributor === undefined)
            {
                for (const el of document.querySelectorAll('*'))
                {
                    const root = (el as any)[backref]
                    if (root?.Services === undefined) continue
                    for (let scope = root.Services; scope !== undefined && contributor === undefined; scope = scope._parent)
                    {
                        for (const [key, entry] of (scope._cache ?? new Map()))
                        {
                            if ((key as any)?.description === p.key) contributor = entry
                        }
                    }
                    break
                }
                if (contributor !== undefined) break
                if (Date.now() > deadline) return { Ok: false, Error: p.notFound }
                await sleep(p.pollMs)
            }
            try
            {
                const model = JSON.stringify({ id: p.packageId, entities: [{ id: 'ihc-smoke-entity' }] })
                const result = await contributor.Contribute(p.environment, p.graphName, p.packageId, [{ id: p.packageId, version: p.version, modelJson: model }])
                const graphs: string[] = await contributor.ListGraphs(p.environment)
                return { Ok: true, PackageCount: result?.PackageCount, Graphs: graphs }
            }
            catch (e)
            {
                // Only the AccountError kind or the sentence: never a token (none is ever in a message).
                return { Ok: false, Error: String((e as any)?.[p.errorKind] ?? (e as any)?.message ?? e) }
            }
        }, {
            backref: RendererGraph.VisualBackref, key: RendererGraph.ContributorKey, notFound: RendererGraph.NotFound,
            pollMs: RendererGraph.PollMs, timeoutMs: RendererGraph.ResolveTimeoutMs, errorKind: RendererGraph.ErrorKind,
            environment, graphName, packageId, version: RendererGraph.PackageVersion,
        })
    }
}

// The spec's inputs, read once from the environment.
class SmokeInputs
{
    public static readonly ConsoleUrlEnv = 'PLEXUS_IHC_CONSOLE_URL'
    public static readonly EnvironmentEnv = 'PLEXUS_IHC_ENVIRONMENT'
    public static readonly SkipMessage =
        `needs a live in-hive console: set ${ScriptedDesktopSignIn.EmailEnv}, ${ScriptedDesktopSignIn.PasswordFileEnv}, `
        + `${ScriptedDesktopSignIn.PlatformAddressEnv}, ${SmokeInputs.ConsoleUrlEnv} and ${SmokeInputs.EnvironmentEnv}`

    private constructor(public readonly ConsoleUrl: string, public readonly Environment: string)
    {
    }

    public static IsConfigured(env: NodeJS.ProcessEnv = process.env): boolean
    {
        return ScriptedDesktopSignIn.IsConfigured(env)
            && SmokeInputs.Value(env, ScriptedDesktopSignIn.PlatformAddressEnv) !== undefined
            && SmokeInputs.Value(env, SmokeInputs.ConsoleUrlEnv) !== undefined
            && SmokeInputs.Value(env, SmokeInputs.EnvironmentEnv) !== undefined
    }

    public static FromEnvironment(env: NodeJS.ProcessEnv = process.env): SmokeInputs
    {
        const consoleUrl = SmokeInputs.Value(env, SmokeInputs.ConsoleUrlEnv)
        const environment = SmokeInputs.Value(env, SmokeInputs.EnvironmentEnv)
        if (consoleUrl === undefined || environment === undefined) throw new Error(SmokeInputs.SkipMessage)
        return new SmokeInputs(consoleUrl, environment)
    }

    private static Value(env: NodeJS.ProcessEnv, name: string): string | undefined
    {
        const value = env[name]?.trim()
        return value === undefined || value === '' ? undefined : value
    }
}

const TenantId = 'pragmatic-default'
const RunningStatus = 'running'
const SignedOutKind = 'signed-out'
const GraphName = 'ihc-smoke-graph'
const PackageId = 'ihc-smoke'
const OperatorNote = 'operator-run by hand outside Plexus: console desktop audit file check (no Bearer in it) and the operator Owner reset (Targets() becomes signed-out within 5 minutes)'

// No trace, screenshot or video: the IdP leg handles the Owner password.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test.describe('in-hive console sign-in live smoke', () => {
    test.skip(!SmokeInputs.IsConfigured(), SmokeInputs.SkipMessage)
    test.setTimeout(600_000)

    test('discover sign-in, console targets and relay contribute, sign out, typed-address sign-in', async () => {
        expect(existsSync(MAIN), `built app missing at ${MAIN} - run npm run build`).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), 'electron binary missing').toBeTruthy()
        test.info().annotations.push({ type: 'not covered', description: OperatorNote })

        const inputs = SmokeInputs.FromEnvironment()
        // Picks the in-hive tenant when the email belongs to several.
        const signIn = ScriptedDesktopSignIn.FromEnvironment({ ...process.env, [ScriptedDesktopSignIn.TenantEnv]: TenantId })
        let profile: E2eProfile | undefined
        let l: Launched | undefined

        try
        {
            const isolated = E2eProfile.Create()
            profile = isolated

            await test.step('launch Plexus, signed out', async () => {
                l = await launchPlexus(isolated)
                // The helper locates the services on first use; the signed-out state is its precondition.
            })

            await test.step('discovery sign-in completes against the tenant', async () => {
                await signIn.SignIn(l!.app, l!.win, isolated)
                const state = await signIn.AccountState(l!.win)
                expect(state.SignedIn, 'account should be signed in').toBeTruthy()
                expect(state.TenantName ?? '', 'signed in with a tenant name').not.toBe('')
            })

            await test.step('targets list the console environment as running', async () => {
                const result = await signIn.Targets(l!.win)
                expect(result.ErrorKind, `targets refused: ${result.ErrorKind ?? ''}`).toBeUndefined()
                const found = result.Targets!.Contribute.find((t) => t.Name === inputs.Environment)
                expect(found, 'the console environment is listed under Contribute').toBeDefined()
                expect(found!.Status).toBe(RunningStatus)
            })

            await test.step('contribute through the console relay and list the graph', async () => {
                const outcome = await RendererGraph.ContributeAndList(l!.win, inputs.Environment, GraphName, PackageId)
                expect(outcome.Ok, `contribute failed: ${outcome.Error ?? ''}`).toBeTruthy()
                expect(outcome.Graphs ?? []).toContain(GraphName)
            })

            await test.step('sign out; targets are refused as signed out', async () => {
                await signIn.EndSession(l!.win)
                const state = await signIn.AccountState(l!.win)
                expect(state.SignedIn).toBeFalsy()
                const result = await signIn.Targets(l!.win)
                expect(result.ErrorKind).toBe(SignedOutKind)
            })

            await test.step('typed console address sign-in lists the environment again', async () => {
                await signIn.SignIn(l!.app, l!.win, isolated, { ConsoleAddress: inputs.ConsoleUrl })
                const result = await signIn.Targets(l!.win)
                expect(result.ErrorKind, `targets refused: ${result.ErrorKind ?? ''}`).toBeUndefined()
                const found = result.Targets!.Contribute.find((t) => t.Name === inputs.Environment)
                expect(found, 'the console environment is listed again').toBeDefined()
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
        }
    })
})
