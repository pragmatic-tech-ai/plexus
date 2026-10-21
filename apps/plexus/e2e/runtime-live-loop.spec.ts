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
import { existsSync, mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RemoteBindMode } from '@pragmatic-tech-ai/todl/build-system-core'
import { TenantPublishStatus } from '@pragmatic-tech-ai/plexus-core/shared/tenant-publish-api.js'
import { launchPlexus, seedSession, MAIN, ELECTRON_EXE, type Launched } from './plexus-app'
import { ContosoFixture, CatalogFixture } from './fixtures/fixture-manifest'
import { DisplayPlacement, type DisplayBounds } from './support/display-placement'
import { OrchestratorClient, RuntimeEnvGraphReader, type DevDescriptor, type RuntimeDescriptor } from './support/orchestrator-client'

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
// `page.evaluate` callbacks, so their bodies execute inside the renderer. The shared root/service
// walk is installed ONCE on `window` by InstallHelpers so no evaluate body re-copies it.
class RendererOps
{
    private static readonly VisualBackref = 'mural:visual-backref'
    private static readonly HelpersKey = '__runtimeLoopHelpers'
    private static readonly PublishStateKey = '__runtimeLoopPublish'
    private static readonly SolutionManagerName = 'SolutionManagerService'
    private static readonly RegistryName = 'HierarchyContributorRegistry'
    private static readonly WorkspaceName = 'SolutionWorkspaceService'
    private static readonly GenerateContributorName = 'GenerateUiContributor'
    private static readonly ContributeContributorName = 'ContributeToGraphContributor'
    private static readonly PublishContributorName = 'PublishTenantContributor'
    private static readonly ProjectFamily = 'project'
    private static readonly SolutionFamily = 'solution'
    private static readonly StageResolve = 'resolve'
    private static readonly StageMutationsMissing = 'mutations-missing'
    private static readonly StageContributorMissing = 'contributor-missing'
    private static readonly Quote = '"'
    private static readonly ResolveTimeoutMs = 60_000
    private static readonly PollMs = 500
    private static readonly PublishWaitMs = 180_000

    // Installs the shared browser-side helpers on `window` once (findRoot + services + byCtor), so
    // the operation evaluates below share a single copy of the mural service-container walk.
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

    // Runs the base scaffold then the real Generate-UI command for the entrypoint concept,
    // non-interactively (concept prompt + completion reporter stubbed on the command instance).
    public static async GenerateUi(win: Page, projectMatch: string, concept: string): Promise<GenerateOutcome>
    {
        return win.evaluate(
            async (p) => {
                const H = (window as any)[p.helpersKey]
                const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
                let member: any, genContrib: any, svc: Record<string, any> = {}
                const deadline = Date.now() + p.resolveTimeoutMs
                for (;;)
                {
                    svc = H.services(H.findRoot())
                    const mgr = svc[p.solutionManagerName]
                    const reg = svc[p.registryName]
                    const members = mgr?.ActiveSolution?.Members?.ToArray?.() ?? []
                    member = members.filter((m: any) => m.Storage !== undefined)
                        .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes(p.projectMatch))
                    if (member && reg) genContrib = H.byCtor(reg.For(p.projectFamily) ?? [], p.generateContributorName)
                    if (member && genContrib) break
                    if (Date.now() > deadline) return { ok: false, stage: p.stageResolve }
                    await sleep(p.pollMs)
                }

                const mutations = svc[p.workspaceName]
                const storage = member.Storage
                const title = member.Title ?? p.projectMatch
                if (mutations === undefined) return { ok: false, stage: p.stageMutationsMissing }
                await mutations.EnsureMemberGenerated(member)

                const cmd: any = genContrib.Create()
                cmd.selection = { Select: async () => p.concept }
                cmd.reporter = { Report: async () => {}, ReportFailure: async (_c: string, e: unknown) => { throw e } }
                await cmd.Run(storage, title)
                return { ok: true, title }
            },
            {
                helpersKey: RendererOps.HelpersKey, projectMatch, concept,
                solutionManagerName: RendererOps.SolutionManagerName, registryName: RendererOps.RegistryName,
                workspaceName: RendererOps.WorkspaceName, generateContributorName: RendererOps.GenerateContributorName,
                projectFamily: RendererOps.ProjectFamily, stageResolve: RendererOps.StageResolve,
                stageMutationsMissing: RendererOps.StageMutationsMissing,
                resolveTimeoutMs: RendererOps.ResolveTimeoutMs, pollMs: RendererOps.PollMs,
            },
        )
    }

    // Configures the graph-server profile on the real IGraphContributor then builds the whole active
    // solution's packages and contributes them to the dev graph — the exact path the Solution row's
    // "Contribute to graph" command runs (minus the dialog prompts).
    public static async Contribute(win: Page, serverUrl: string, token: string, graphName: string): Promise<ContributeOutcome>
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
                await contributor.SetProfile(p.serverUrl, p.token)
                const packages = [...await builder.Build()]
                const result = await contributor.Contribute(p.graphName, solution.Name, packages)
                return { ok: true, packageCount: result?.PackageCount }
            },
            {
                helpersKey: RendererOps.HelpersKey, serverUrl, token, graphName,
                registryName: RendererOps.RegistryName, solutionFamily: RendererOps.SolutionFamily,
                contributeContributorName: RendererOps.ContributeContributorName,
                stageResolve: RendererOps.StageResolve, stageContributorMissing: RendererOps.StageContributorMissing,
                resolveTimeoutMs: RendererOps.ResolveTimeoutMs, pollMs: RendererOps.PollMs,
            },
        )
    }

    // Rewrites one quoted literal in a project file THROUGH the opened member's own IStorage, so the
    // v2 content is written to the exact storage the next solution build reads from. Returns whether
    // the replacement actually changed the file (so the caller can assert the edit landed). This is
    // what guarantees the re-promote recompiles v2: the write and the build's read share one IStorage.
    public static async UpdateProjectValue(win: Page, projectMatch: string, fileName: string, original: string, updated: string): Promise<{ ok: boolean; changed?: boolean; stage?: string }>
    {
        return win.evaluate(
            async (p) => {
                const H = (window as any)[p.helpersKey]
                const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
                let member: any
                const deadline = Date.now() + p.resolveTimeoutMs
                for (;;)
                {
                    const mgr = H.services(H.findRoot())[p.solutionManagerName]
                    const members = mgr?.ActiveSolution?.Members?.ToArray?.() ?? []
                    member = members.filter((m: any) => m.Storage !== undefined)
                        .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes(p.projectMatch))
                    if (member) break
                    if (Date.now() > deadline) return { ok: false, stage: p.stageResolve }
                    await sleep(p.pollMs)
                }
                const text: string = await member.Storage.ReadText(p.fileName)
                const next = text.split(p.quote + p.original + p.quote).join(p.quote + p.updated + p.quote)
                await member.Storage.WriteText(p.fileName, next)
                return { ok: true, changed: next !== text }
            },
            {
                helpersKey: RendererOps.HelpersKey, projectMatch, fileName, original, updated,
                solutionManagerName: RendererOps.SolutionManagerName, stageResolve: RendererOps.StageResolve,
                quote: RendererOps.Quote, resolveTimeoutMs: RendererOps.ResolveTimeoutMs, pollMs: RendererOps.PollMs,
            },
        )
    }

    // Configures the tenant publisher then drives the real Publish-env command (html-bundle-remote
    // build with RemoteBindMode.Environment -> IPC deploy). Mirrors sp1-plexus-smoke: wrap the build
    // service + publisher to capture outcomes into a window state object, invoke, then wait for a
    // terminal signal. `bind` is RemoteBindMode.Environment (the `tenant.publish-env` path).
    public static async PublishEnv(win: Page, serverUrl: string, token: string, projectMatch: string, bind: RemoteBindMode): Promise<PublishOutcome>
    {
        await win.evaluate(
            async (p) => {
                const H = (window as any)[p.helpersKey]
                const svc = H.services(H.findRoot())
                const mgr = svc[p.solutionManagerName]
                const member = (mgr?.ActiveSolution?.Members?.ToArray?.() ?? []).filter((m: any) => m.Storage)
                    .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes(p.projectMatch))
                const pub = H.byCtor(svc[p.registryName].For(p.projectFamily) ?? [], p.publishContributorName)
                const state: any = (window as any)[p.stateKey] = {}
                await pub.publisher.SetProfile(p.serverUrl, p.token)

                const origBuild = pub.buildService.Build.bind(pub.buildService)
                pub.buildService.Build = async (...a: any[]) => {
                    try
                    {
                        const r = await origBuild(...a)
                        state.buildOk = r.Result.Ok
                        if (!r.Result.Ok) state.buildError = 'build diagnostics present'
                        return r
                    }
                    catch (e)
                    {
                        state.buildError = String((e as any)?.message ?? e)
                        throw e
                    }
                }
                const origPub = pub.publisher.Publish.bind(pub.publisher)
                pub.publisher.Publish = async (dir: string) => {
                    try
                    {
                        const r = await origPub(dir)
                        state.publishStatus = r?.Status
                        return r
                    }
                    catch (e)
                    {
                        state.publishError = String((e as any)?.message ?? e)
                        throw e
                    }
                }
                // Drive the private publish(member, bind) directly (TS-private; reachable at runtime),
                // the same call the resolved `tenant.publish-env` RelayCommand makes.
                try { pub.publish(member, p.bind) } catch (e) { state.invokeError = String((e as any)?.message ?? e) }
            },
            {
                helpersKey: RendererOps.HelpersKey, serverUrl, token, projectMatch, bind,
                solutionManagerName: RendererOps.SolutionManagerName, registryName: RendererOps.RegistryName,
                projectFamily: RendererOps.ProjectFamily, publishContributorName: RendererOps.PublishContributorName,
                stateKey: RendererOps.PublishStateKey,
            },
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

// One captured served-app console/pageerror record: its kind (console type or 'pageerror'), the page
// url it came from, and the message/stack text (redacted before it is ever written out).
interface BrowserLogEntry
{
    kind: string
    url: string
    detail: string
}

// Drives a real chromium browser on the second monitor: authenticates via /auth/browser-login (the
// session cookie is stored in the context's cookie jar via its request API, then shared with pages),
// navigates to the served app, and asserts what the app renders.
//
// Smoke capture: every page opened in a context it creates is wired for `console` (error + warning)
// and `pageerror`, collected into `log`. Those served-app exceptions were invisible before — nothing
// attached a console listener to the chromium pages — so WriteReport dumps them (deduped, redacted)
// to a gitignored artifact for triage.
class BrowserReader
{
    private static readonly BrowserLoginPath = '/auth/browser-login'
    private static readonly TenantQuery = '?tenant='
    private static readonly AppPathPrefix = '/app/'
    private static readonly PathSep = '/'
    private static readonly RenderTimeoutMs = 60_000
    private static readonly EmailKey = 'email'
    private static readonly PasswordKey = 'password'
    private static readonly PageEvent = 'page'
    private static readonly ConsoleEvent = 'console'
    private static readonly PageErrorEvent = 'pageerror'
    private static readonly RequestFailedEvent = 'requestfailed'
    private static readonly ResponseEvent = 'response'
    private static readonly ConsoleErrorType = 'error'
    private static readonly ConsoleWarningType = 'warning'
    private static readonly PageErrorKind = 'pageerror'
    private static readonly RequestFailedKind = 'requestfailed'
    private static readonly HttpErrorPrefix = 'http '
    private static readonly HttpErrorThreshold = 400
    private static readonly ProbeKindPrefix = 'font-probe '
    private static readonly ProbeErrorKind = 'font-probe error'
    private static readonly FontHeadDetail = 'HEAD font asset'
    // The Pragmatic theme registers its font faces by the relative url `fonts/<name>.woff2`; these are
    // exactly the woff2s the installed mural package ships. The server serves a path ONLY if the app
    // manifest's ui.assets lists it, so a HEAD here returns 200 iff the font was emitted AND is served.
    private static readonly FontProbePaths: readonly string[] = [
        'fonts/InterTight-Regular.woff2',
        'fonts/InterTight-Medium.woff2',
        'fonts/InterTight-SemiBold.woff2',
        'fonts/JetBrainsMono-Regular.woff2',
        'fonts/JetBrainsMono-Medium.woff2',
        'fonts/SourceSerif4-Regular.woff2',
    ]
    private static readonly KeySep = '\u0000'
    private static readonly Utf8 = 'utf8'
    private static readonly Indent = '    '
    private static readonly Newline = '\n'

    private browser: Browser | undefined
    private readonly log: BrowserLogEntry[] = []

    public async Launch(origin: { x: number; y: number }): Promise<void>
    {
        this.browser = await chromium.launch({ headless: false, args: [DisplayPlacement.ChromiumWindowPositionArg(origin)] })
    }

    public async NewSignedInContext(appOriginBase: string, tenant: string, email: string, password: string): Promise<BrowserContext>
    {
        if (this.browser === undefined) throw new Error('BrowserReader.Launch must run first')
        const context = await this.browser.newContext()
        // Fires for every page created in this context (including the spec's own context.newPage()),
        // synchronously before navigation — so load-time exceptions are caught too.
        context.on(BrowserReader.PageEvent, (page) => this.WirePage(page))
        const loginUrl = `${appOriginBase}${BrowserReader.BrowserLoginPath}${BrowserReader.TenantQuery}${encodeURIComponent(tenant)}`
        const response = await context.request.post(loginUrl, { data: { [BrowserReader.EmailKey]: email, [BrowserReader.PasswordKey]: password } })
        expect(response.ok(), `browser-login failed (HTTP ${response.status()})`).toBeTruthy()
        return context
    }

    public static AppUrl(appOriginBase: string, tenant: string, appId: string): string
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

    public async Close(): Promise<void>
    {
        await this.browser?.close().catch(() => {})
        this.browser = undefined
    }

    // Attaches console (error + warning only) and pageerror listeners to one served-app page; every
    // record lands in `log` with the page url captured at emit time.
    private WirePage(page: Page): void
    {
        page.on(BrowserReader.ConsoleEvent, (m) => {
            const type = m.type()
            if (type === BrowserReader.ConsoleErrorType || type === BrowserReader.ConsoleWarningType)
            {
                this.log.push({ kind: type, url: page.url(), detail: m.text() })
            }
        })
        page.on(BrowserReader.PageErrorEvent, (e) => {
            this.log.push({ kind: BrowserReader.PageErrorKind, url: page.url(), detail: e.stack ?? e.message })
        })
        // Exact failing-resource URLs: a bare "404 Failed to load resource" console line never names
        // the URL, so capture it here — the font woff2s the served app needs show up as either an
        // outright request failure or a 4xx/5xx response, with their real URL and resource type.
        page.on(BrowserReader.RequestFailedEvent, (req) => {
            this.log.push({ kind: BrowserReader.RequestFailedKind, url: req.url(), detail: `${req.resourceType()}: ${req.failure()?.errorText ?? ''}` })
        })
        page.on(BrowserReader.ResponseEvent, (resp) => {
            if (resp.status() >= BrowserReader.HttpErrorThreshold)
            {
                this.log.push({ kind: BrowserReader.HttpErrorPrefix + resp.status(), url: resp.url(), detail: resp.request().resourceType() })
            }
        })
    }

    // HEADs each theme font asset at the served app route and records its HTTP status. This is the
    // decisive check for "are the fonts actually served": the AppServingEndpoint serves a path only if
    // the app manifest lists it in ui.assets, so 404 here means the woff2 was never emitted/listed
    // (which collapses mural's glyph-geometry text measurement to NaN), while 200 means it is served.
    public async ProbeFonts(context: BrowserContext, appOriginBase: string, tenant: string, appId: string): Promise<void>
    {
        const base = appOriginBase + BrowserReader.AppPathPrefix + tenant + BrowserReader.PathSep + appId + BrowserReader.PathSep
        for (const rel of BrowserReader.FontProbePaths)
        {
            const url = base + rel
            try
            {
                const resp = await context.request.head(url)
                this.log.push({ kind: BrowserReader.ProbeKindPrefix + resp.status(), url, detail: BrowserReader.FontHeadDetail })
            }
            catch (e)
            {
                this.log.push({ kind: BrowserReader.ProbeErrorKind, url, detail: e instanceof Error ? e.message : String(e) })
            }
        }
    }

    // Writes the captured served-app console/pageerror records to `filePath`, deduped by kind+detail
    // with an occurrence count (first-seen order) and every field passed through `redact`. Returns the
    // raw and unique counts for the one-line run summary. Creates the artifact directory if needed.
    public WriteReport(filePath: string, redact: (text: string) => string): { total: number; unique: number }
    {
        const groups = new Map<string, { kind: string; url: string; detail: string; count: number }>()
        for (const entry of this.log)
        {
            const key = entry.kind + BrowserReader.KeySep + entry.detail
            const existing = groups.get(key)
            if (existing !== undefined)
            {
                existing.count++
            }
            else
            {
                groups.set(key, { kind: entry.kind, url: entry.url, detail: entry.detail, count: 1 })
            }
        }
        const lines: string[] = [`served-app console capture — ${this.log.length} records, ${groups.size} unique`, '']
        for (const g of groups.values())
        {
            lines.push(`[${g.kind} x${g.count}] ${redact(g.url)}`)
            lines.push(redact(g.detail).split(BrowserReader.Newline).map((l) => BrowserReader.Indent + l).join(BrowserReader.Newline))
            lines.push('')
        }
        mkdirSync(path.dirname(filePath), { recursive: true })
        writeFileSync(filePath, lines.join(BrowserReader.Newline), BrowserReader.Utf8)
        return { total: this.log.length, unique: groups.size }
    }
}

// Clones the Contoso fixture into a throwaway temp dir so the re-promote step can mutate its seeded
// data without ever touching the committed corpus. The same clone is the project Plexus opens; the
// v2 edit is written back THROUGH the opened member's IStorage (RendererOps.UpdateProjectValue),
// not raw fs, so the second build is guaranteed to recompile the edited content.
class ContosoClone
{
    private static readonly ClonePrefix = 'plexus-contoso-'

    public readonly Folder: string

    private constructor(folder: string)
    {
        this.Folder = folder
    }

    public static From(sourceFolder: string, prefix: string = ContosoClone.ClonePrefix): ContosoClone
    {
        const folder = mkdtempSync(path.join(tmpdir(), prefix))
        cpSync(sourceFolder, folder, { recursive: true })
        return new ContosoClone(folder)
    }

    public Dispose(): void
    {
        try { rmSync(this.Folder, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
    }
}

const GateEnv = 'SP_RUNTIME_LOOP_E2E'
const GateValue = '1'
const WindowOriginEnv = 'SP_E2E_WINDOW_ORIGIN'
// Smoke capture artifacts (gitignored under e2e/.artifacts/): the served-app chromium console and the
// Plexus Electron renderer console, both dumped unconditionally in teardown for error triage.
const ArtifactDir = path.resolve(__dirname, '.artifacts')
const BrowserConsoleArtifact = path.join(ArtifactDir, 'smoke-browser-console.log')
const RendererConsoleArtifact = path.join(ArtifactDir, 'smoke-renderer-console.log')

const ProjectMatch = 'contoso'
// The .todl is named after the project id (Task 3 fixture convention).
const TodlFileName = `${ContosoFixture.appId}.todl`
const PrePromoteCypher = 'MATCH (n) RETURN n LIMIT 1'
const NoEnvironmentGraphPattern = /no environment graph is loaded/i
// The readTenant/RBAC gate's deny reason for a principal with no covering grant.
const PermissionDeniedPattern = /no grant covers this action on this resource/i
const GraphName = 'loop-graph'
// The re-promote step rewrites the one seeded assert value to this distinct v2 string. It must NOT
// contain the original (so "original no longer shown" is a robust check).
const V2Value = 'Fabrikam Quantum Kettle'
const ReloadTimeoutMs = 60_000

// Connector leg (live Postgres read-through): the catalog fixture binds `products` via the env's provisioned DB.
const CatalogProjectMatch = 'catalog'
const CatalogClonePrefix = 'plexus-catalog-'
// All five columns: the compiled populate FieldMap is total over the effective schema (label/description are prelude-inherited).
const CreateProductsSql = "CREATE TABLE products (id text primary key, name text, unit_price numeric, label text, description text); INSERT INTO products VALUES ('p1', 'Live Postgres Widget', 249, 'Live Postgres Widget', 'A live Postgres-backed product');"
const UpdateProductSql = "UPDATE products SET name = 'Updated Postgres Widget' WHERE id = 'p1';"
const UpdatedProductName = 'Updated Postgres Widget'

test.describe('runtime publishing live loop', () => {
    test.skip(process.env[GateEnv] !== GateValue, `set ${GateEnv}=${GateValue} to run`)
    test.setTimeout(900_000)

    test('real app contribute -> promote -> publish-env -> browser read', async () => {
        expect(existsSync(MAIN), `built app missing at ${MAIN} — run npm run build`).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), 'electron binary missing').toBeTruthy()

        const orchestrator = OrchestratorClient.Create()
        const clone = ContosoClone.From(ContosoFixture.folder)
        // Cloned too: Generate UI writes into the project, which must never touch the committed fixture.
        const catalogClone = ContosoClone.From(CatalogFixture.folder, CatalogClonePrefix)
        const restore = seedSession([clone.Folder, catalogClone.Folder])
        const reader = new BrowserReader()
        let l: Launched | undefined
        let dev: DevDescriptor | undefined
        let rt: RuntimeDescriptor | undefined

        try
        {
            // Step 2: launch Plexus, place it on the second monitor, install shared renderer helpers.
            l = await launchPlexus()
            const origin = await WindowPlacer.PlaceOnSecondMonitor(l, process.env[WindowOriginEnv])
            await RendererOps.InstallHelpers(l.win)

            // Step 3: open Contoso (seeded above) + Generate UI for the entrypoint concept.
            await test.step('Generate UI', async () => {
                const gen = await RendererOps.GenerateUi(l!.win, ProjectMatch, ContosoFixture.entrypointConcept)
                expect(gen, `generate stage: ${gen.stage ?? ''}`).toMatchObject({ ok: true })
            })

            // Step 4a: Phase 1 (create-dev) + Contribute the solution packages to the dev graph.
            await test.step('create-dev + Contribute', async () => {
                dev = await orchestrator.CreateDev(GraphName)
                const contributed = await RendererOps.Contribute(l!.win, dev.devWsUrl, dev.makerToken, dev.graphName)
                expect(contributed, `contribute stage: ${contributed.stage ?? ''}`).toMatchObject({ ok: true })
            })

            // Step 4b: create the runtime (CREATE + PROVISION only — no promote). The runtime env
            // exists and reader/ungranted accounts are provisioned, but the env graph is still EMPTY.
            await test.step('create-runtime (env graph empty)', async () => {
                rt = await orchestrator.CreateRuntime()
            })

            // Step 5: pre-promote read assertion (Review focus) — UNCONDITIONAL. A read against the
            // runtime's environment graph before anything is promoted must surface the clear
            // NoEnvironmentGraphError to the client, not a crash/blank. Driven node-side over the real
            // PragmaticClient: log in as the reader, connect, run one Cypher read WITHOUT
            // OpenApplication so it resolves to the (empty) environment graph.
            await test.step('pre-promote: NoEnvironmentGraphError surfaces cleanly', async () => {
                const outcome = await new RuntimeEnvGraphReader().ReadEnvGraph(rt!.appOriginBase, rt!.runtimeWsUrl, rt!.tenant, rt!.reader.email, rt!.reader.password, PrePromoteCypher)
                expect(outcome.Ok, 'a runtime with nothing promoted must reject the env read, not return rows').toBeFalsy()
                expect(outcome.ErrorMessage ?? '').toMatch(NoEnvironmentGraphPattern)
            })

            // Step 6: promote the dev graph into the existing runtime env.
            await test.step('promote dev graph into runtime', async () => {
                const promoted = await orchestrator.Promote(dev!.graphName)
                expect(promoted.packageCount, 'promote contributed zero packages').toBeGreaterThan(0)
            })

            // Step 7: configure tenant + Publish-env the Contoso app (RemoteBindMode.Environment).
            await test.step('Publish-env', async () => {
                const published = await RendererOps.PublishEnv(l!.win, rt!.runtimeWsUrl, rt!.deployToken, ProjectMatch, RemoteBindMode.Environment)
                expect(published.buildError, published.buildError).toBeUndefined()
                expect(published.buildOk, 'html-bundle-remote build failed').toBeTruthy()
                expect(published.invokeError, published.invokeError).toBeUndefined()
                expect(published.publishError, published.publishError).toBeUndefined()
                expect(published.publishStatus, `publish status: ${published.publishStatus ?? ''}`).toBe(TenantPublishStatus.Applied)
            })

            // Step 8: the milestone — a real browser on the second monitor reads the promoted value.
            await test.step('browser read (milestone)', async () => {
                await reader.Launch(origin)
                const context = await reader.NewSignedInContext(rt!.appOriginBase, rt!.tenant, rt!.reader.email, rt!.reader.password)
                await reader.AssertRenders(context, rt!.appOriginBase, rt!.tenant, ContosoFixture.appId, ContosoFixture.assertValue)
                // Decisive "are the fonts served?" check (smoke): HEAD the theme woff2s at the app route.
                await reader.ProbeFonts(context, rt!.appOriginBase, rt!.tenant, ContosoFixture.appId)
            })

            // Step 9: ungranted-denied assertion (Review focus) — a REAL denial proof. A graph IS
            // loaded now, so an env-graph read as the ungranted account must be refused by the
            // readTenant/RBAC gate (a permission denial), NOT the no-graph error. Driven node-side
            // over PragmaticClient (symmetric with step 5) so the proof does not depend on SPA timing.
            await test.step('ungranted read is denied by RBAC', async () => {
                const outcome = await new RuntimeEnvGraphReader().ReadEnvGraph(rt!.appOriginBase, rt!.runtimeWsUrl, rt!.tenant, rt!.ungranted.email, rt!.ungranted.password, PrePromoteCypher)
                expect(outcome.Ok, 'an ungranted principal must be refused the env read').toBeFalsy()
                expect(outcome.ErrorMessage ?? '').toMatch(PermissionDeniedPattern)
                expect(outcome.ErrorMessage ?? '', 'denial must be a permission refusal, not the no-graph error').not.toMatch(NoEnvironmentGraphPattern)
            })

            // Step 10: re-promote assertion (Review focus) — UNCONDITIONAL. Change the one seeded
            // assert value in the open solution to a distinct v2 string, re-contribute into the SAME
            // dev graph, promote again (idempotent), then reload the already-served app and assert the
            // v2 value renders while the original no longer appears — reflected live, NO redeploy.
            await test.step('re-promote reflected on reload, no redeploy', async () => {
                // Write v2 through the opened member's IStorage (not raw fs): the next build reads the
                // same storage, so it is guaranteed to recompile the edited content (see report P1).
                const edited = await RendererOps.UpdateProjectValue(l!.win, ProjectMatch, TodlFileName, ContosoFixture.assertValue, V2Value)
                expect(edited, `edit stage: ${edited.stage ?? ''}`).toMatchObject({ ok: true, changed: true })
                const recontributed = await RendererOps.Contribute(l!.win, dev!.devWsUrl, dev!.makerToken, dev!.graphName)
                expect(recontributed, `re-contribute stage: ${recontributed.stage ?? ''}`).toMatchObject({ ok: true })
                await orchestrator.Promote(dev!.graphName)

                const context = await reader.NewSignedInContext(rt!.appOriginBase, rt!.tenant, rt!.reader.email, rt!.reader.password)
                const page = await context.newPage()
                await page.goto(BrowserReader.AppUrl(rt!.appOriginBase, rt!.tenant, ContosoFixture.appId))
                await page.reload()
                await expect(page.getByText(V2Value, { exact: false })).toBeVisible({ timeout: ReloadTimeoutMs })
                // exact:false substring match — a stale render of the original inside any node fails this.
                await expect(page.getByText(ContosoFixture.assertValue, { exact: false })).toHaveCount(0)
            })

            // Step 11: connector leg - the Catalog app reads LIVE from the env's provisioned Postgres.
            // A row is inserted, the app is generated/contributed/promoted/published, a signed-in browser
            // sees the row, then the row is UPDATED in Postgres and the page merely reloaded (NO
            // re-promote): the new value rendering proves a read-through, not a baked-in snapshot.
            await test.step('live Postgres read, no re-promote', async () => {
                await orchestrator.DbExec(CreateProductsSql)

                const gen = await RendererOps.GenerateUi(l!.win, CatalogProjectMatch, CatalogFixture.entrypointConcept)
                expect(gen, `catalog generate stage: ${gen.stage ?? ''}`).toMatchObject({ ok: true })
                const contributed = await RendererOps.Contribute(l!.win, dev!.devWsUrl, dev!.makerToken, dev!.graphName)
                expect(contributed, `catalog contribute stage: ${contributed.stage ?? ''}`).toMatchObject({ ok: true })
                await orchestrator.Promote(dev!.graphName)

                const published = await RendererOps.PublishEnv(l!.win, rt!.runtimeWsUrl, rt!.deployToken, CatalogProjectMatch, RemoteBindMode.Environment)
                expect(published.buildError, published.buildError).toBeUndefined()
                expect(published.buildOk, 'catalog html-bundle-remote build failed').toBeTruthy()
                expect(published.invokeError, published.invokeError).toBeUndefined()
                expect(published.publishError, published.publishError).toBeUndefined()
                expect(published.publishStatus, `catalog publish status: ${published.publishStatus ?? ''}`).toBe(TenantPublishStatus.Applied)

                const context = await reader.NewSignedInContext(rt!.appOriginBase, rt!.tenant, rt!.reader.email, rt!.reader.password)
                const page = await reader.AssertRenders(context, rt!.appOriginBase, rt!.tenant, CatalogFixture.appId, CatalogFixture.assertValue)

                await orchestrator.DbExec(UpdateProductSql)
                await page.reload()
                await expect(page.getByText(UpdatedProductName, { exact: false })).toBeVisible({ timeout: ReloadTimeoutMs })
                await expect(page.getByText(CatalogFixture.assertValue, { exact: false })).toHaveCount(0)
            })
        }
        finally
        {
            // Step 12: teardown — each step is independent so a throw in one never skips the costly
            // container/env cleanup (orchestrator.Teardown). Any descriptor secret that could, in
            // principle, appear in a captured error is redacted before anything is written out.
            const secrets = [dev?.makerToken, rt?.deployToken, rt?.reader.password, rt?.ungranted.password]
                .filter((s): s is string => typeof s === 'string' && s.length > 0)
            const redact = (text: string): string => secrets.reduce((acc, s) => acc.split(s).join('***'), text)

            // Served-app console/pageerror dump — written BEFORE Close so a mid-test failure still
            // flushes whatever the browser captured up to that point.
            const browser = reader.WriteReport(BrowserConsoleArtifact, redact)
            console.log(`[runtime-loop] served-app console: ${browser.total} records (${browser.unique} unique) -> ${BrowserConsoleArtifact}`)

            await reader.Close().catch(() => {})
            if (l !== undefined)
            {
                mkdirSync(ArtifactDir, { recursive: true })
                writeFileSync(RendererConsoleArtifact, [...l.errors.map((e) => 'ERROR ' + e), ...l.warnings.map((w) => 'WARN  ' + w)].map(redact).join('\n'), 'utf8')
                const appErrs = l.errors.filter((e) => !/Insecure Content-Security-Policy|Electron Security Warning|devtools|Autofill\./i.test(e))
                console.log(`[runtime-loop] renderer console: ${l.errors.length} errors, ${l.warnings.length} warnings (${appErrs.length} non-ignorable) -> ${RendererConsoleArtifact}`)
                await l.app.close().catch(() => {})
            }
            try { restore() } catch { /* restore is best-effort; must not skip Teardown */ }
            await orchestrator.Teardown().catch(() => {})
            clone.Dispose()
            catalogClone.Dispose()
        }
    })
})
