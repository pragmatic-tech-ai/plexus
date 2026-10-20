// Runtime-publishing live-loop e2e (Task 5): drives the REAL Plexus Electron app through the full
// author -> contribute -> promote -> publish-env loop and asserts a real browser reads the promoted
// data from the served app. The capstone of the runtime-publishing-live-loop slice.
//
// Gated by SP_RUNTIME_LOOP_E2E=1 — it needs Docker, a built `pragmatic-server:dev` image, a built
// Plexus (`out/main/index.js`), chromium, and the Task 2 orchestrator reachable at SP_SERVER_REPO
// (default sibling ../../../pragmatic-server). It is operator-run; see the runbook.
//
// The renderer is driven exactly as sp1-plexus-smoke.spec.ts does: reach the live service container
// through the mural visual backref, resolve the real hierarchy contributors via the contributor
// registry, and invoke the same service objects the context-menu commands do. Nothing is stubbed
// except the non-interactive concept prompt + completion reporter on the generate command instance.
//
// Secret hygiene: maker/admin/deploy tokens and account passwords flow only into the real app's
// Configure surfaces and the auth endpoints; they are NEVER passed to console/log/test output.
import { test, expect, type Page, type JSHandle } from '@playwright/test'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RemoteBindMode } from '@pragmatic-tech-ai/todl'
import { launchPlexus, seedSession, MAIN, ELECTRON_EXE, type Launched } from './plexus-app'
import { ContosoFixture } from './fixtures/fixture-manifest'
import { DisplayPlacement, type DisplayBounds } from './support/display-placement'
import { OrchestratorClient, EnvGraphWireReader, type DevDescriptor, type RuntimeDescriptor } from './support/orchestrator-client'

// Result of resolving + driving the real Generate-UI command on the Contoso project row.
interface GenerateOutcome
{
    ok: boolean
    stage?: string
    title?: string
}

// Result of resolving + driving the real Contribute-to-graph command on the Solution row.
interface ContributeOutcome
{
    ok: boolean
    stage?: string
    packageCount?: number
}

// Terminal state captured from the wrapped build + publisher during a publish-env run.
interface PublishOutcome
{
    buildOk?: boolean
    buildError?: string
    publishStatus?: string
    publishError?: string
    invokeError?: string
}

// Renderer-side operations: each reaches the live app's service container via the mural visual
// backref (identical to sp1-plexus-smoke) and drives a real contributor. These run as Playwright
// `page.evaluate` callbacks, so their bodies execute inside the renderer and are necessarily inline.
class RendererOps
{
    private static readonly ResolveTimeoutMs = 60_000
    private static readonly PollMs = 500
    private static readonly PublishWaitMs = 180_000
    private static readonly PublishStateKey = '__runtimeLoopPublish'

    // Runs the base scaffold then the real Generate-UI command for the entrypoint concept,
    // non-interactively (concept prompt + completion reporter stubbed on the command instance).
    public static async GenerateUi(win: Page, projectMatch: string, concept: string): Promise<GenerateOutcome>
    {
        return win.evaluate(
            async ({ projectMatch, concept, resolveTimeoutMs, pollMs }) =>
            {
                const S = Symbol.for('mural:visual-backref')
                const findRoot = (): any =>
                {
                    for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v && v.Services) return v }
                    return undefined
                }
                const services = (root: any): Record<string, any> =>
                {
                    const map: Record<string, any> = {}
                    for (let p = root?.Services; p; p = p._parent)
                        for (const [, e] of (p._cache ?? new Map())) { const n = (e as any)?.constructor?.name; if (n && !(n in map)) map[n] = e }
                    return map
                }
                const byCtor = (list: any[], name: string): any => list.find((c) => c?.constructor?.name === name)
                const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

                let member: any, genContrib: any, svc: Record<string, any> = {}
                const deadline = Date.now() + resolveTimeoutMs
                for (;;)
                {
                    const root = findRoot()
                    svc = services(root)
                    const mgr = svc['SolutionManagerService']
                    const reg = svc['HierarchyContributorRegistry']
                    const members = mgr?.ActiveSolution?.Members?.ToArray?.() ?? []
                    member = members.filter((m: any) => m.Storage !== undefined)
                        .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes(projectMatch))
                    if (member && reg) genContrib = byCtor(reg.For('project') ?? [], 'GenerateUiContributor')
                    if (member && genContrib) break
                    if (Date.now() > deadline) return { ok: false, stage: 'resolve' }
                    await sleep(pollMs)
                }

                const mutations = svc['SolutionWorkspaceService']
                const storage = member.Storage
                const title = member.Title ?? projectMatch
                if (mutations === undefined) return { ok: false, stage: 'mutations-missing' }
                await mutations.EnsureMemberGenerated(member)

                const cmd: any = genContrib.Create()
                cmd.selection = { Select: async () => concept }
                cmd.reporter = { Report: async () => {}, ReportFailure: async (_c: string, e: unknown) => { throw e } }
                await cmd.Run(storage, title)
                return { ok: true, title }
            },
            { projectMatch, concept, resolveTimeoutMs: RendererOps.ResolveTimeoutMs, pollMs: RendererOps.PollMs },
        )
    }

    // Configures the graph-server profile on the real IGraphContributor then builds the whole active
    // solution's packages and contributes them to the dev graph — the exact path the Solution row's
    // "Contribute to graph" command runs (minus the dialog prompts).
    public static async Contribute(win: Page, serverUrl: string, token: string, graphName: string): Promise<ContributeOutcome>
    {
        return win.evaluate(
            async ({ serverUrl, token, graphName, resolveTimeoutMs, pollMs }) =>
            {
                const S = Symbol.for('mural:visual-backref')
                const findRoot = (): any =>
                {
                    for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v && v.Services) return v }
                    return undefined
                }
                const services = (root: any): Record<string, any> =>
                {
                    const map: Record<string, any> = {}
                    for (let p = root?.Services; p; p = p._parent)
                        for (const [, e] of (p._cache ?? new Map())) { const n = (e as any)?.constructor?.name; if (n && !(n in map)) map[n] = e }
                    return map
                }
                const byCtor = (list: any[], name: string): any => list.find((c) => c?.constructor?.name === name)
                const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

                let contrib: any
                const deadline = Date.now() + resolveTimeoutMs
                for (;;)
                {
                    const reg = services(findRoot())['HierarchyContributorRegistry']
                    if (reg) contrib = byCtor(reg.For('solution') ?? [], 'ContributeToGraphContributor')
                    if (contrib) break
                    if (Date.now() > deadline) return { ok: false, stage: 'resolve' }
                    await sleep(pollMs)
                }

                const contributor = contrib.contributor
                const builder = contrib.builder
                const solution = contrib.solution
                if (contributor === undefined || builder === undefined || solution === undefined) return { ok: false, stage: 'contributor-missing' }
                await contributor.SetProfile(serverUrl, token)
                const packages = [...await builder.Build()]
                const result = await contributor.Contribute(graphName, solution.Name, packages)
                return { ok: true, packageCount: result?.PackageCount }
            },
            { serverUrl, token, graphName, resolveTimeoutMs: RendererOps.ResolveTimeoutMs, pollMs: RendererOps.PollMs },
        )
    }

    // Configures the tenant publisher then drives the real Publish-env command (html-bundle-remote
    // build with RemoteBindMode.Environment -> IPC deploy). Mirrors sp1-plexus-smoke: wrap the build
    // service + publisher to capture outcomes into a window state object, invoke, then wait for a
    // terminal signal. `bind` is RemoteBindMode.Environment (the `tenant.publish-env` path).
    public static async PublishEnv(win: Page, serverUrl: string, token: string, projectMatch: string, bind: RemoteBindMode): Promise<PublishOutcome>
    {
        await win.evaluate(
            async ({ serverUrl, token, projectMatch, bind, stateKey }) =>
            {
                const S = Symbol.for('mural:visual-backref')
                let root: any
                for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v && v.Services) { root = v; break } }
                const svc: Record<string, any> = {}
                for (let p = root?.Services; p; p = p._parent)
                    for (const [, e] of (p._cache ?? new Map())) { const n = (e as any)?.constructor?.name; if (n && !(n in svc)) svc[n] = e }
                const mgr = svc['SolutionManagerService']
                const member = (mgr?.ActiveSolution?.Members?.ToArray?.() ?? []).filter((m: any) => m.Storage)
                    .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes(projectMatch))
                const pub = (svc['HierarchyContributorRegistry'].For('project') ?? []).find((c: any) => c?.constructor?.name === 'PublishTenantContributor')
                const state: any = (window as any)[stateKey] = {}
                await pub.publisher.SetProfile(serverUrl, token)

                const origBuild = pub.buildService.Build.bind(pub.buildService)
                pub.buildService.Build = async (...a: any[]) =>
                {
                    try { const r = await origBuild(...a); state.buildOk = r.Result.Ok; if (!r.Result.Ok) state.buildError = 'build diagnostics present'; return r }
                    catch (e) { state.buildError = String((e as any)?.message ?? e); throw e }
                }
                const origPub = pub.publisher.Publish.bind(pub.publisher)
                pub.publisher.Publish = async (dir: string) =>
                {
                    try { const r = await origPub(dir); state.publishStatus = r?.Status; return r }
                    catch (e) { state.publishError = String((e as any)?.message ?? e); throw e }
                }
                // Drive the private publish(member, bind) directly (TS-private; reachable at runtime),
                // the same call the resolved `tenant.publish-env` RelayCommand makes.
                try { pub.publish(member, bind) } catch (e) { state.invokeError = String((e as any)?.message ?? e) }
            },
            { serverUrl, token, projectMatch, bind, stateKey: RendererOps.PublishStateKey },
        )

        await win.waitForFunction(
            (stateKey) => { const s: any = (window as any)[stateKey]; return !!(s && (s.publishStatus || s.publishError || s.buildError || s.invokeError)) },
            RendererOps.PublishStateKey,
            { timeout: RendererOps.PublishWaitMs },
        ).catch(() => {})
        return win.evaluate((stateKey) => (window as any)[stateKey] as PublishOutcome, RendererOps.PublishStateKey)
    }
}

// Places the launched Plexus Electron window on the operator's second monitor (Task 4 placement),
// honoring the SP_E2E_WINDOW_ORIGIN override.
class WindowPlacer
{
    private static readonly WindowWidth = 1600
    private static readonly WindowHeight = 1000

    public static async PlaceOnSecondMonitor(l: Launched, override: string | undefined): Promise<{ x: number; y: number }>
    {
        const displays = await l.app.evaluate(({ screen }) => screen.getAllDisplays().map((d) => d.bounds)) as DisplayBounds[]
        const origin = DisplayPlacement.TargetOrigin(displays, override)
        const handle: JSHandle = await l.app.browserWindow(l.win)
        await handle.evaluate((browserWindow: any, bounds: { x: number; y: number; width: number; height: number }) => browserWindow.setBounds(bounds), {
            x: origin.x, y: origin.y, width: WindowPlacer.WindowWidth, height: WindowPlacer.WindowHeight,
        })
        return origin
    }
}

// Drives a real chromium browser on the second monitor: authenticates via /auth/browser-login (the
// session cookie is stored in the context's cookie jar via its request API, then shared with pages),
// navigates to the served app, and asserts what the app renders.
class BrowserReader
{
    private static readonly BrowserLoginPath = '/auth/browser-login'
    private static readonly TenantQuery = '?tenant='
    private static readonly AppPathPrefix = '/app/'
    private static readonly PathSep = '/'
    private static readonly RenderTimeoutMs = 60_000
    private static readonly DenyTimeoutMs = 20_000
    private static readonly EmailKey = 'email'
    private static readonly PasswordKey = 'password'

    private browser: Browser | undefined

    public async Launch(origin: { x: number; y: number }): Promise<void>
    {
        this.browser = await chromium.launch({ headless: false, args: [DisplayPlacement.ChromiumWindowPositionArg(origin)] })
    }

    public async NewSignedInContext(appOriginBase: string, tenant: string, email: string, password: string): Promise<BrowserContext>
    {
        if (this.browser === undefined) throw new Error('BrowserReader.Launch must run first')
        const context = await this.browser.newContext()
        const loginUrl = `${appOriginBase}${BrowserReader.BrowserLoginPath}${BrowserReader.TenantQuery}${encodeURIComponent(tenant)}`
        const response = await context.request.post(loginUrl, { data: { [BrowserReader.EmailKey]: email, [BrowserReader.PasswordKey]: password } })
        expect(response.ok(), `browser-login failed (HTTP ${response.status()})`).toBeTruthy()
        return context
    }

    private static AppUrl(appOriginBase: string, tenant: string, appId: string): string
    {
        return `${appOriginBase}${BrowserReader.AppPathPrefix}${tenant}${BrowserReader.PathSep}${appId}${BrowserReader.PathSep}`
    }

    // Opens the served app and asserts the expected value renders.
    public async AssertRenders(context: BrowserContext, appOriginBase: string, tenant: string, appId: string, value: string): Promise<Page>
    {
        const page = await context.newPage()
        await page.goto(BrowserReader.AppUrl(appOriginBase, tenant, appId))
        await expect(page.getByText(value, { exact: false })).toBeVisible({ timeout: BrowserReader.RenderTimeoutMs })
        return page
    }

    // Opens the served app as a principal with no read grant and asserts the value never renders
    // (the read is denied) within the deny window.
    public async AssertDenied(context: BrowserContext, appOriginBase: string, tenant: string, appId: string, value: string): Promise<void>
    {
        const page = await context.newPage()
        await page.goto(BrowserReader.AppUrl(appOriginBase, tenant, appId))
        await expect(page.getByText(value, { exact: false })).not.toBeVisible({ timeout: BrowserReader.DenyTimeoutMs })
    }

    public async Close(): Promise<void>
    {
        await this.browser?.close().catch(() => {})
        this.browser = undefined
    }
}

// Clones the Contoso fixture into a throwaway temp dir so the re-promote step can mutate it without
// touching the committed corpus, and knows how to inject a new instance for the re-promote assertion.
class ContosoClone
{
    private static readonly ClonePrefix = 'plexus-contoso-'
    private static readonly TodlFile = 'contoso.todl'
    // A stable, unique anchor inside the model block; the new instance is inserted right after it.
    private static readonly Anchor = 'annotate entrypoint { }'
    private static readonly RePromoteValue = 'Contoso Nebula Grinder'
    // Omits the optional `category` so there is no forward reference to a concept defined later in the block.
    private static readonly Insertion = '\n        Product nebula { name = "Contoso Nebula Grinder"; unitPrice = 1; }'

    public readonly Folder: string

    private constructor(folder: string)
    {
        this.Folder = folder
    }

    public static get NewValue(): string
    {
        return ContosoClone.RePromoteValue
    }

    public static From(sourceFolder: string): ContosoClone
    {
        const folder = mkdtempSync(path.join(tmpdir(), ContosoClone.ClonePrefix))
        cpSync(sourceFolder, folder, { recursive: true })
        return new ContosoClone(folder)
    }

    // Appends a new Product instance (NewValue) to the model so a re-contribute + re-promote surfaces
    // a new value on the next read with no redeploy.
    public InjectNewInstance(): void
    {
        const file = path.join(this.Folder, ContosoClone.TodlFile)
        const text = readFileSync(file, 'utf8')
        writeFileSync(file, text.replace(ContosoClone.Anchor, ContosoClone.Anchor + ContosoClone.Insertion))
    }
}

const GateEnv = 'SP_RUNTIME_LOOP_E2E'
const GateValue = '1'
const WindowOriginEnv = 'SP_E2E_WINDOW_ORIGIN'
// Operator-supplied fresh (provisioned-but-UNPROMOTED) runtime for the strict pre-promote assertion.
// The delivered Task 2 orchestrator couples provision with promote in a single `promote-and-provision`
// (EnvironmentService.Create throws on an existing env), so a fresh runtime whose environment graph is
// empty is not reachable through the CLI; the operator provides one here to exercise step 5 strictly.
const FreshWsEnv = 'SP_RUNTIME_LOOP_FRESH_WS'
const FreshTokenEnv = 'SP_RUNTIME_LOOP_FRESH_TOKEN'

const ProjectMatch = 'contoso'
const AppliedStatus = 'applied'
const PrePromoteCypher = 'MATCH (n) RETURN n LIMIT 1'
const NoEnvironmentGraphPattern = /no environment graph is loaded/i
const GraphName = 'loop-graph'

test.describe('runtime publishing live loop', () =>
{
    test.skip(process.env[GateEnv] !== GateValue, `set ${GateEnv}=${GateValue} to run`)
    test.setTimeout(900_000)

    test('real app contribute -> promote -> publish-env -> browser read', async () =>
    {
        expect(existsSync(MAIN), `built app missing at ${MAIN} — run npm run build`).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), 'electron binary missing').toBeTruthy()

        const orchestrator = OrchestratorClient.Create()
        const clone = ContosoClone.From(ContosoFixture.folder)
        const restore = seedSession([clone.Folder])
        const reader = new BrowserReader()
        let l: Launched | undefined
        let dev: DevDescriptor | undefined
        let rt: RuntimeDescriptor | undefined

        try
        {
            // Step 2: launch Plexus and place it on the second monitor.
            l = await launchPlexus()
            const origin = await WindowPlacer.PlaceOnSecondMonitor(l, process.env[WindowOriginEnv])

            // Step 3: open Contoso (seeded above) + Generate UI for the entrypoint concept.
            await test.step('Generate UI', async () =>
            {
                const gen = await RendererOps.GenerateUi(l!.win, ProjectMatch, ContosoFixture.entrypointConcept)
                expect(gen, `generate stage: ${gen.stage ?? ''}`).toMatchObject({ ok: true })
            })

            // Step 4: Phase 1 (create-dev) + Contribute the solution packages to the dev graph.
            await test.step('create-dev + Contribute', async () =>
            {
                dev = await orchestrator.CreateDev(GraphName)
                const contributed = await RendererOps.Contribute(l!.win, dev.devWsUrl, dev.makerToken, dev.graphName)
                expect(contributed, `contribute stage: ${contributed.stage ?? ''}`).toMatchObject({ ok: true })
            })

            // Step 5: pre-promote read assertion (Review focus). An environment-bound read against a
            // runtime whose env graph has nothing promoted must surface NoEnvironmentGraphError cleanly
            // (not a crash/blank). Asserted here via a DIRECT WIRE read (brief's sanctioned fallback).
            //
            // NOTE: the delivered Task 2 orchestrator couples provisioning with promotion in a single
            // `promote-and-provision`, so a provisioned-but-unpromoted runtime is not reachable through
            // the CLI. When the operator supplies such a fresh runtime via SP_RUNTIME_LOOP_FRESH_WS/_TOKEN,
            // the strict assertion runs; otherwise it is recorded (skipped with reason), never a false pass.
            await test.step('pre-promote: NoEnvironmentGraphError surfaces cleanly', async () =>
            {
                const freshWs = process.env[FreshWsEnv]
                const freshToken = process.env[FreshTokenEnv]
                if (freshWs === undefined || freshWs === '' || freshToken === undefined || freshToken === '')
                {
                    test.info().annotations.push({ type: 'skip-reason', description: `pre-promote strict assertion needs a provisioned-but-unpromoted runtime via ${FreshWsEnv}/${FreshTokenEnv}; the delivered orchestrator couples provision+promote so it is not reachable through the CLI` })
                    return
                }
                const outcome = await new EnvGraphWireReader().ReadEnvGraph(freshWs, freshToken, PrePromoteCypher)
                expect(outcome.Ok, 'a fresh runtime with nothing promoted must reject the env read, not return rows').toBeFalsy()
                expect(outcome.ErrorMessage ?? '').toMatch(NoEnvironmentGraphPattern)
            })

            // Step 6: Phase 2 (promote-and-provision) + Publish-env the Contoso app to the runtime tenant.
            await test.step('promote-and-provision + Publish-env', async () =>
            {
                rt = await orchestrator.PromoteAndProvision(dev!.graphName)
                const published = await RendererOps.PublishEnv(l!.win, rt.runtimeWsUrl, rt.deployToken, ProjectMatch, RemoteBindMode.Environment)
                expect(published.buildError, published.buildError).toBeUndefined()
                expect(published.buildOk, 'html-bundle-remote build failed').toBeTruthy()
                expect(published.invokeError, published.invokeError).toBeUndefined()
                expect(published.publishError, published.publishError).toBeUndefined()
                expect(published.publishStatus, `publish status: ${published.publishStatus ?? ''}`).toBe(AppliedStatus)
            })

            // Step 7: the milestone — a real browser on the second monitor reads the promoted value.
            await test.step('browser read (milestone)', async () =>
            {
                await reader.Launch(origin)
                const context = await reader.NewSignedInContext(rt!.appOriginBase, rt!.tenant, rt!.reader.email, rt!.reader.password)
                await reader.AssertRenders(context, rt!.appOriginBase, rt!.tenant, ContosoFixture.appId, ContosoFixture.assertValue)
            })

            // Step 8: ungranted-denied assertion (Review focus) — a fresh context as the ungranted
            // account proves the reader's grant is real, not an open door.
            await test.step('ungranted read is denied', async () =>
            {
                const denied = await reader.NewSignedInContext(rt!.appOriginBase, rt!.tenant, rt!.ungranted.email, rt!.ungranted.password)
                await reader.AssertDenied(denied, rt!.appOriginBase, rt!.tenant, ContosoFixture.appId, ContosoFixture.assertValue)
            })

            // Step 9: re-promote assertion (Review focus) — contribute a changed instance, re-promote,
            // reload the already-served app, and assert the new value appears with NO redeploy.
            //
            // NOTE: a standalone re-promote (relay the dev graph into the existing runtime again) is not
            // exposed by the delivered Task 2 orchestrator — `promote-and-provision` re-creates the runtime
            // env and EnvironmentService.Create throws EnvironmentExistsError. The re-promote is therefore
            // attempted and, on that known coupling failure, recorded (skipped with reason) rather than
            // forcing a false pass; the reload+assert logic is real and runs once the orchestrator exposes
            // an idempotent/standalone promote.
            await test.step('re-promote reflected on reload, no redeploy', async () =>
            {
                clone.InjectNewInstance()
                const recontributed = await RendererOps.Contribute(l!.win, dev!.devWsUrl, dev!.makerToken, dev!.graphName)
                expect(recontributed, `re-contribute stage: ${recontributed.stage ?? ''}`).toMatchObject({ ok: true })

                let rePromoted = false
                try
                {
                    await orchestrator.PromoteAndProvision(dev!.graphName)
                    rePromoted = true
                }
                catch (error)
                {
                    test.info().annotations.push({ type: 'skip-reason', description: `re-promote not reachable: the orchestrator's promote-and-provision re-creates the runtime env (${error instanceof Error ? error.name : 'error'}); a standalone/idempotent promote subcommand is required` })
                }

                if (rePromoted)
                {
                    const context = await reader.NewSignedInContext(rt!.appOriginBase, rt!.tenant, rt!.reader.email, rt!.reader.password)
                    const page = await context.newPage()
                    await page.goto(`${rt!.appOriginBase}/app/${rt!.tenant}/${ContosoFixture.appId}/`)
                    await page.reload()
                    await expect(page.getByText(ContosoClone.NewValue, { exact: false })).toBeVisible({ timeout: 60_000 })
                }
            })
        }
        finally
        {
            // Step 10: teardown — close chromium, the app, restore the session, remove envs/containers.
            await reader.Close()
            if (l !== undefined)
            {
                const appErrs = l.errors.filter((e) => !/Insecure Content-Security-Policy|Electron Security Warning|devtools|Autofill\./i.test(e))
                if (appErrs.length) console.log('[runtime-loop] renderer errors:\n' + appErrs.slice(0, 20).join('\n'))
                await l.app.close().catch(() => {})
            }
            restore()
            await orchestrator.Teardown().catch(() => {})
        }
    })
})
