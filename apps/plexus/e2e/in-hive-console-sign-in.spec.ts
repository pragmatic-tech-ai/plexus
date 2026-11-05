// Live smoke: Plexus signs in to an IN-HIVE tenant console and contributes through its relay.
//
// Operator-run against a real cluster (never part of the unit gates). It skips unless every env var
// below is set. Prerequisites (established by the operator before running; see the Task 9 brief):
//   - the console installed on the hive with development TLS, its environment (PLEXUS_IHC_ENVIRONMENT)
//     created and running, and the control plane advertising the console (discovery returns consoleUrl);
//   - the dev CA trusted by the OS store, so Plexus main reaches the console over https with no CA option;
//   - the IdP login runs in a separate headless Chromium (PLEXUS_E2E_IDP_LOGIN=browser, set by the
//     spec), which trusts the OS store, so PLEXUS_E2E_IDP_CA_FILE is not needed.
//
// Inputs (environment variables, all required):
//   PLEXUS_E2E_PLATFORM_ADDRESS     platform address used by the discovery sign-in (e.g. http://localhost:7000)
//   PLEXUS_E2E_OWNER_EMAIL          the tenant Owner's email
//   PLEXUS_E2E_OWNER_PASSWORD_FILE  path of a file holding the Owner's password (read, never printed)
//   PLEXUS_IHC_CONSOLE_URL          the console address (e.g. https://console-pragmatic-default.localtest.me)
//   PLEXUS_IHC_ENVIRONMENT          the environment created on the console (e.g. smoke-ihd)
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

// Renderer-side graph operations through the preload's graph-contribute bridge (window.api.graphContribute):
// the IPC the app's own Contribute command uses, so main reaches the environment through the console relay
// with the account session and no credential crosses into the renderer.
class RendererGraph
{
    private static readonly BridgeKey = 'graphContribute'
    private static readonly NotFound = 'the graph-contribute bridge is not exposed on window.api'
    private static readonly Failed = 'the relay call failed'
    private static readonly EntityId = 'ihc-smoke-entity'
    private static readonly PackageVersion = '1.0.0'

    // Contributes a one-entity package to the environment's graph, then lists the environment's graphs.
    public static async ContributeAndList(win: Page, environment: string, graphName: string, packageId: string): Promise<GraphOutcome>
    {
        return win.evaluate(async (p) =>
        {
            const bridge = (window as any).api?.[p.bridgeKey]
            if (bridge === undefined) return { Ok: false, Error: p.notFound }
            // Each call answers a RelayReply envelope: { Ok, Value } or { Ok: false, Error: { Kind?, Message? } }.
            const failure = (reply: any): string => String(reply?.Error?.Kind ?? reply?.Error?.Message ?? p.failed)
            const model = JSON.stringify({ id: p.packageId, entities: [{ id: p.entityId }] })
            const contributed = await bridge.Contribute(p.environment, p.graphName, p.packageId, [{ id: p.packageId, version: p.version, modelJson: model }])
            if (!contributed?.Ok) return { Ok: false, Error: failure(contributed) }
            const listed = await bridge.ListGraphs(p.environment)
            if (!listed?.Ok) return { Ok: false, Error: failure(listed) }
            return { Ok: true, PackageCount: contributed.Value?.PackageCount, Graphs: listed.Value }
        }, {
            bridgeKey: RendererGraph.BridgeKey, notFound: RendererGraph.NotFound, failed: RendererGraph.Failed,
            entityId: RendererGraph.EntityId, environment, graphName, packageId, version: RendererGraph.PackageVersion,
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
        // Picks the in-hive tenant when the email belongs to several; the in-hive IdP serves a
        // JavaScript login, so its login runs in a headless browser trusting the OS store.
        const signIn = ScriptedDesktopSignIn.FromEnvironment({ ...process.env, [ScriptedDesktopSignIn.TenantEnv]: TenantId, [ScriptedDesktopSignIn.IdpLoginEnv]: ScriptedDesktopSignIn.IdpLoginBrowser })
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
