// Live smoke: Plexus signs in to an IN-HIVE tenant console and contributes through its relay; with the
// optional inputs it also signs in at the platform and contributes to a console graph, and a second
// test checks that a retired console refuses the sign-in.
//
// Operator-run against a real cluster (never part of the unit gates). It skips unless every required
// env var below is set. Prerequisites (established by the operator before running; see the Task 9 brief):
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
// Optional inputs (each step that needs one skips with an annotation when it is unset):
//   PLEXUS_IHC_GRAPH                a graph created on PLEXUS_IHC_ENVIRONMENT through the console's
//                                   tenant-api (the console graph contribute step)
//   PLEXUS_IHC_PLATFORM_ENVIRONMENT a control-plane environment of the same tenant (the platform step)
//   PLEXUS_IHC_PLATFORM_EMAIL       the platform account's email (default: PLEXUS_E2E_OWNER_EMAIL)
//   PLEXUS_IHC_PLATFORM_PASSWORD_FILE  path of a file holding the platform account's password (the
//                                   platform step; read inside ScriptedDesktopSignIn, never printed)
//   PLEXUS_IHC_EXPECT_RETIRED=1     the console is retired: only the retired-console test runs (the
//                                   typed console sign-in fails with console-retired before any browser
//                                   opens), and the live test skips
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
import { PlatformAccess, TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// The contribute outcome as the renderer reports it.
interface GraphOutcome
{
    Ok: boolean
    Error?: string
    PackageCount?: number
    Graphs?: string[]
}

// Renderer-side graph operations through the preload's graph-contribute bridge (window.api.graphContribute):
// the IPC the app's own Contribute command uses, so main reaches the environment through the relay of the
// target's source with that source's session and no credential crosses into the renderer.
class RendererGraph
{
    private static readonly BridgeKey = 'graphContribute'
    private static readonly NotFound = 'the graph-contribute bridge is not exposed on window.api'
    private static readonly Failed = 'the relay call failed'
    private static readonly TimedOut = 'the relay call timed out'
    private static readonly CallTimeoutMs = 60_000
    private static readonly EntityId = 'ihc-smoke-entity'
    private static readonly PackageVersion = '1.0.0'

    // Contributes a one-entity package to the target environment's graph, then lists its graphs. Only
    // the target's Name and Source cross IPC (main refuses a bare environment name).
    public static ContributeAndList(win: Page, target: TargetRef, graphName: string, packageId: string): Promise<GraphOutcome>
    {
        return RendererGraph.Run(win, target, { graphName, packageId })
    }

    // Lists the target environment's graphs only.
    public static List(win: Page, target: TargetRef): Promise<GraphOutcome>
    {
        return RendererGraph.Run(win, target, undefined)
    }

    private static async Run(win: Page, target: TargetRef, contribution: { graphName: string; packageId: string } | undefined): Promise<GraphOutcome>
    {
        return win.evaluate(async (p) =>
        {
            const bridge = (window as any).api?.[p.bridgeKey]
            if (bridge === undefined) return { Ok: false, Error: p.notFound }
            // Each call answers a RelayReply envelope: { Ok, Value } or { Ok: false, Error: { Kind?, Message? } }.
            // Each call is raced against a bounded timer so a hung relay fails the step with a step-only error.
            const bounded = async (call: Promise<any>): Promise<any> =>
            {
                let timer: ReturnType<typeof setTimeout> | undefined
                const timeout = new Promise<any>((resolve) => { timer = setTimeout(() => resolve({ Ok: false, Error: { Message: p.timedOut } }), p.callTimeoutMs) })
                try
                {
                    return await Promise.race([call, timeout])
                }
                finally
                {
                    clearTimeout(timer)
                }
            }
            const failure = (reply: any): string => String(reply?.Error?.Kind ?? reply?.Error?.Message ?? p.failed)
            let packageCount: number | undefined
            if (p.contribution !== undefined)
            {
                const { graphName, packageId } = p.contribution
                const model = JSON.stringify({ id: packageId, entities: [{ id: p.entityId }] })
                const contributed = await bounded(bridge.Contribute(p.target, graphName, packageId, [{ id: packageId, version: p.version, modelJson: model }]))
                if (!contributed?.Ok) return { Ok: false, Error: failure(contributed) }
                packageCount = contributed.Value?.PackageCount
            }
            const listed = await bounded(bridge.ListGraphs(p.target))
            if (!listed?.Ok) return { Ok: false, Error: failure(listed) }
            return { Ok: true, PackageCount: packageCount, Graphs: listed.Value }
        }, {
            bridgeKey: RendererGraph.BridgeKey, notFound: RendererGraph.NotFound, failed: RendererGraph.Failed,
            timedOut: RendererGraph.TimedOut, callTimeoutMs: RendererGraph.CallTimeoutMs,
            entityId: RendererGraph.EntityId, target: { Name: target.Name, Source: target.Source }, contribution, version: RendererGraph.PackageVersion,
        })
    }
}

// The spec's inputs, read once from the environment.
class SmokeInputs
{
    public static readonly ConsoleUrlEnv = 'PLEXUS_IHC_CONSOLE_URL'
    public static readonly EnvironmentEnv = 'PLEXUS_IHC_ENVIRONMENT'
    public static readonly GraphEnv = 'PLEXUS_IHC_GRAPH'
    public static readonly PlatformEnvironmentEnv = 'PLEXUS_IHC_PLATFORM_ENVIRONMENT'
    public static readonly ExpectRetiredEnv = 'PLEXUS_IHC_EXPECT_RETIRED'
    public static readonly SkipMessage =
        `needs a live in-hive console: set ${ScriptedDesktopSignIn.EmailEnv}, ${ScriptedDesktopSignIn.PasswordFileEnv}, `
        + `${ScriptedDesktopSignIn.PlatformAddressEnv}, ${SmokeInputs.ConsoleUrlEnv} and ${SmokeInputs.EnvironmentEnv}`
    public static readonly RetiredSelected = `${SmokeInputs.ExpectRetiredEnv}=1 selects the retired-console test only`
    public static readonly RetiredNotSelected = `runs only with ${SmokeInputs.ExpectRetiredEnv}=1 (a retired console)`
    public static readonly NoGraph = `set ${SmokeInputs.GraphEnv} (a graph created on the console environment) to contribute to a console graph`
    public static readonly NoPlatform =
        `set ${SmokeInputs.PlatformEnvironmentEnv} and ${ScriptedDesktopSignIn.PlatformPasswordFileEnv} to sign in at the platform; Skip was pressed instead`
    private static readonly RetiredValue = '1'

    private constructor(
        public readonly ConsoleUrl: string,
        public readonly Environment: string,
        public readonly Graph: string | undefined,
        public readonly PlatformEnvironment: string | undefined,
    )
    {
    }

    // Whether the console is expected retired (selects the retired-console test).
    public static ExpectRetired(env: NodeJS.ProcessEnv = process.env): boolean
    {
        return SmokeInputs.Value(env, SmokeInputs.ExpectRetiredEnv) === SmokeInputs.RetiredValue
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
        return new SmokeInputs(consoleUrl, environment, SmokeInputs.Value(env, SmokeInputs.GraphEnv), SmokeInputs.Value(env, SmokeInputs.PlatformEnvironmentEnv))
    }

    // The graph that no environment has: the console graph's name with the missing suffix.
    public MissingGraph(graph: string): string
    {
        return graph + SmokeConstants.MissingSuffix
    }

    // The exact sentence a contribute to a graph the environment no longer has fails with.
    public GraphGoneSentence(graph: string): string
    {
        return SmokeConstants.GraphGonePrefix + graph + SmokeConstants.GraphGoneMiddle + this.Environment + SmokeConstants.GraphGoneSuffix
    }

    private static Value(env: NodeJS.ProcessEnv, name: string): string | undefined
    {
        const value = env[name]?.trim()
        return value === undefined || value === '' ? undefined : value
    }
}

// The spec's literals: data values, annotation text, step titles and assertion messages.
class SmokeConstants
{
    public static readonly TenantId = 'pragmatic-default'
    public static readonly RunningStatus = 'running'
    public static readonly SignedOutKind = 'signed-out'
    public static readonly ConsoleRetiredKind = 'console-retired'
    public static readonly PackageId = 'ihc-smoke'
    public static readonly MissingSuffix = '-missing'
    // RelayConnector's graph-gone sentence: The graph <graph> no longer exists in <environment>. ...
    public static readonly GraphGonePrefix = 'The graph '
    public static readonly GraphGoneMiddle = ' no longer exists in '
    public static readonly GraphGoneSuffix = '. Create it again in the tenant console.'
    public static readonly SkippedStepType = 'skipped step'
    public static readonly NotCoveredType = 'not covered'
    public static readonly OperatorNote =
        'operator-run by hand outside Plexus: console desktop audit file check (no Bearer in it) and the operator Owner reset (Targets() becomes signed-out within 5 minutes)'
    public static readonly SuiteTitle = 'in-hive console sign-in live smoke'
    public static readonly TestTitle =
        'discover sign-in, the platform step, console targets and graph contribute, sign out, typed-address sign-in'
    public static readonly RetiredTestTitle = 'a retired console refuses the typed sign-in before any browser opens'
    public static readonly ElectronMissing = 'electron binary missing'
    public static readonly StepLaunch = 'launch Plexus, signed out'
    public static readonly StepDiscoverySignIn = 'discovery sign-in completes against the tenant'
    public static readonly StepPlatform = 'platform sign-in adds the platform environment to the targets'
    public static readonly StepTargets = 'targets list the console environment as running'
    public static readonly StepContribute = 'contribute to the console graph, and a missing graph fails with its sentence'
    public static readonly StepSignOut = 'sign out; targets are refused as signed out'
    public static readonly StepTypedSignIn = 'typed console address sign-in lists the environment again'
    public static readonly StepRetired = 'typed console sign-in fails as console-retired with no browser opened'
    public static readonly ShouldBeSignedIn = 'account should be signed in'
    public static readonly HasTenantName = 'signed in with a tenant name'
    public static readonly PlatformOffered = 'the platform sign-in is offered'
    public static readonly PlatformSignedIn = 'the platform is signed in'
    public static readonly PlatformGone = 'no platform access after sign-out'
    public static readonly ListedUnderContribute = 'the console environment is listed under Contribute'
    public static readonly ConsoleListed = 'the console environment is listed with Source console'
    public static readonly PlatformListed = 'the platform environment is listed with Source platform'
    public static readonly ListedAgain = 'the console environment is listed again'
    public static readonly GraphListed = 'the console graph is listed after the contribute'
    public static readonly MissingFails = 'a contribute to the missing graph fails'
    public static readonly NoBrowserOpened = 'no browser was opened for a retired console'
    public static readonly TargetsRefusedPrefix = 'targets refused: '
    public static readonly ContributeFailedPrefix = 'contribute failed: '
    public static readonly ListFailedPrefix = 'graph listing failed: '

    public static BuiltAppMissing(main: string): string
    {
        return `built app missing at ${main} - run npm run build`
    }
}

// The spec's scripted sign-in: picks the in-hive tenant when the email belongs to several; the IdPs
// serve a JavaScript login, so each login runs in a headless browser trusting the OS store.
class SmokeSignIn
{
    public static Create(): ScriptedDesktopSignIn
    {
        return ScriptedDesktopSignIn.FromEnvironment({
            ...process.env,
            [ScriptedDesktopSignIn.TenantEnv]: SmokeConstants.TenantId,
            [ScriptedDesktopSignIn.IdpLoginEnv]: ScriptedDesktopSignIn.IdpLoginBrowser,
        })
    }
}

// No trace, screenshot or video: the IdP leg handles the Owner password.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test.describe(SmokeConstants.SuiteTitle, () => {
    test.skip(!SmokeInputs.IsConfigured(), SmokeInputs.SkipMessage)
    test.setTimeout(600_000)

    test(SmokeConstants.TestTitle, async () => {
        test.skip(SmokeInputs.ExpectRetired(), SmokeInputs.RetiredSelected)
        expect(existsSync(MAIN), SmokeConstants.BuiltAppMissing(MAIN)).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), SmokeConstants.ElectronMissing).toBeTruthy()
        test.info().annotations.push({ type: SmokeConstants.NotCoveredType, description: SmokeConstants.OperatorNote })

        const inputs = SmokeInputs.FromEnvironment()
        const signIn = SmokeSignIn.Create()
        const platformStep = inputs.PlatformEnvironment !== undefined && signIn.HasPlatformLogin
        let profile: E2eProfile | undefined
        let l: Launched | undefined

        try
        {
            const isolated = E2eProfile.Create()
            profile = isolated

            await test.step(SmokeConstants.StepLaunch, async () => {
                l = await launchPlexus(isolated)
                // The helper locates the services on first use; the signed-out state is its precondition.
            })

            await test.step(SmokeConstants.StepDiscoverySignIn, async () => {
                await signIn.SignIn(l!.app, l!.win, isolated)
                const state = await signIn.AccountState(l!.win)
                expect(state.SignedIn, SmokeConstants.ShouldBeSignedIn).toBeTruthy()
                expect(state.TenantName ?? '', SmokeConstants.HasTenantName).not.toBe('')
                // Without the platform inputs the dialog's platform offer is skipped, so it closes.
                if (!platformStep) await signIn.SkipPlatform(l!.win)
            })

            if (platformStep)
            {
                await test.step(SmokeConstants.StepPlatform, async () => {
                    const offered = await signIn.AccountState(l!.win)
                    expect(offered.Platform, SmokeConstants.PlatformOffered).toBe(PlatformAccess.Offered)
                    await signIn.SignInAtPlatform(l!.app, l!.win)
                    const state = await signIn.AccountState(l!.win)
                    expect(state.Platform, SmokeConstants.PlatformSignedIn).toBe(PlatformAccess.SignedIn)
                    const result = await signIn.Targets(l!.win)
                    expect(result.ErrorKind, SmokeConstants.TargetsRefusedPrefix + (result.ErrorKind ?? '')).toBeUndefined()
                    const contribute = result.Targets!.Contribute
                    const consoleRow = contribute.find((t) => t.Name === inputs.Environment && t.Source === TargetSource.Console)
                    expect(consoleRow, SmokeConstants.ConsoleListed).toBeDefined()
                    const platform = contribute.find((t) => t.Name === inputs.PlatformEnvironment && t.Source === TargetSource.Platform)
                    expect(platform, SmokeConstants.PlatformListed).toBeDefined()
                    const listed = await RendererGraph.List(l!.win, { Name: platform!.Name, Source: TargetSource.Platform })
                    expect(listed.Ok, SmokeConstants.ListFailedPrefix + (listed.Error ?? '')).toBeTruthy()
                    expect(Array.isArray(listed.Graphs), SmokeConstants.ListFailedPrefix).toBeTruthy()
                })
            }
            else
            {
                test.info().annotations.push({ type: SmokeConstants.SkippedStepType, description: SmokeInputs.NoPlatform })
            }

            await test.step(SmokeConstants.StepTargets, async () => {
                const result = await signIn.Targets(l!.win)
                expect(result.ErrorKind, SmokeConstants.TargetsRefusedPrefix + (result.ErrorKind ?? '')).toBeUndefined()
                const found = result.Targets!.Contribute.find((t) => t.Name === inputs.Environment && t.Source === TargetSource.Console)
                expect(found, SmokeConstants.ListedUnderContribute).toBeDefined()
                expect(found!.Status).toBe(SmokeConstants.RunningStatus)
            })

            const graph = inputs.Graph
            if (graph !== undefined)
            {
                await test.step(SmokeConstants.StepContribute, async () => {
                    const target = { Name: inputs.Environment, Source: TargetSource.Console }
                    const outcome = await RendererGraph.ContributeAndList(l!.win, target, graph, SmokeConstants.PackageId)
                    expect(outcome.Ok, SmokeConstants.ContributeFailedPrefix + (outcome.Error ?? '')).toBeTruthy()
                    expect(outcome.Graphs ?? [], SmokeConstants.GraphListed).toContain(graph)
                    const missing = inputs.MissingGraph(graph)
                    const refused = await RendererGraph.ContributeAndList(l!.win, target, missing, SmokeConstants.PackageId)
                    expect(refused.Ok, SmokeConstants.MissingFails).toBeFalsy()
                    expect(refused.Error).toBe(inputs.GraphGoneSentence(missing))
                })
            }
            else
            {
                test.info().annotations.push({ type: SmokeConstants.SkippedStepType, description: SmokeInputs.NoGraph })
            }

            await test.step(SmokeConstants.StepSignOut, async () => {
                await signIn.EndSession(l!.win)
                const state = await signIn.AccountState(l!.win)
                expect(state.SignedIn).toBeFalsy()
                expect(state.Platform, SmokeConstants.PlatformGone).toBeUndefined()
                const result = await signIn.Targets(l!.win)
                expect(result.ErrorKind).toBe(SmokeConstants.SignedOutKind)
            })

            await test.step(SmokeConstants.StepTypedSignIn, async () => {
                await signIn.SignIn(l!.app, l!.win, isolated, { ConsoleAddress: inputs.ConsoleUrl })
                const result = await signIn.Targets(l!.win)
                expect(result.ErrorKind, SmokeConstants.TargetsRefusedPrefix + (result.ErrorKind ?? '')).toBeUndefined()
                const found = result.Targets!.Contribute.find((t) => t.Name === inputs.Environment)
                expect(found, SmokeConstants.ListedAgain).toBeDefined()
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

    test(SmokeConstants.RetiredTestTitle, async () => {
        test.skip(!SmokeInputs.ExpectRetired(), SmokeInputs.RetiredNotSelected)
        expect(existsSync(MAIN), SmokeConstants.BuiltAppMissing(MAIN)).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), SmokeConstants.ElectronMissing).toBeTruthy()

        const inputs = SmokeInputs.FromEnvironment()
        const signIn = SmokeSignIn.Create()
        let profile: E2eProfile | undefined
        let l: Launched | undefined

        try
        {
            const isolated = E2eProfile.Create()
            profile = isolated

            await test.step(SmokeConstants.StepLaunch, async () => {
                l = await launchPlexus(isolated)
            })

            await test.step(SmokeConstants.StepRetired, async () => {
                const kind = await signIn.AttemptConsoleSignIn(l!.app, l!.win, isolated, inputs.ConsoleUrl)
                expect(kind).toBe(SmokeConstants.ConsoleRetiredKind)
                expect(signIn.LastAttemptOpenedBrowser, SmokeConstants.NoBrowserOpened).toBeFalsy()
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
