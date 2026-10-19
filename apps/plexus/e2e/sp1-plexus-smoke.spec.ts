// SP1 full-smoke: drive the REAL Plexus author->generate->publish loop against a live
// runtime tenant, then (outside this spec) verify the served app. Gated by SP1_SMOKE=1.
//
// This is not a product test — it is a manual smoke harness. It reaches Plexus's live
// service container (via the mural visual backref the plexus-app helper uses) and invokes
// the actual Generate UI + Publish-to-tenant service objects, so it exercises the same
// code the context-menu commands do, without brittle SVG menu clicking. The concept-
// selection prompt and the completion dialog are stubbed on the real command instance so
// the run is non-interactive; everything else (scaffold, concept UI generation, the
// html-bundle-remote build, the IPC deploy over PragmaticClient.DeployApplication) is real.
import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, MAIN, ELECTRON_EXE } from './plexus-app'

const GATE = process.env.SP1_SMOKE === '1'
const PROJECT_DIR = process.env.SP1_PROJECT_DIR ?? 'C:/tmp/sp1-smoke/project'
const TENANT_PORT = process.env.SP1_TENANT_PORT ?? '8091'
const TENANT = 'sp1'
const SECRETS = process.env.SP1_SECRETS ?? 'C:/tmp/sp1-smoke/bundle/provisioned-secrets.json'
const SERVER_URL = `ws://localhost:${TENANT_PORT}/?tenant=${TENANT}`
const CONCEPT = 'sp1.task'

// Admin bearer token for the publish profile. Obtained by logging in with the tenant admin
// (password read from the local bundle); never printed.
async function adminToken(): Promise<string>
{
    const pw = JSON.parse(readFileSync(SECRETS, 'utf8'))[`${TENANT}-admin-pw`] as string
    const resp = await fetch(`http://localhost:${TENANT_PORT}/auth/login?tenant=${TENANT}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `admin@${TENANT}.test`, password: pw }),
    })
    const json = (await resp.json()) as { token?: string }
    if (!json.token) throw new Error('admin login returned no token')
    return json.token
}

test.describe('SP1 Plexus smoke', () =>
{
    test.skip(!GATE, 'set SP1_SMOKE=1 to run')
    test.setTimeout(300_000)

    test('author -> generate UI -> publish to tenant', async () =>
    {
        expect(existsSync(MAIN), `built app missing at ${MAIN} — run npm run build`).toBeTruthy()
        expect(existsSync(ELECTRON_EXE), 'electron binary missing').toBeTruthy()
        const token = await adminToken()
        const restore = seedSession([path.resolve(PROJECT_DIR)])
        const l = await launchPlexus()
        try
        {
            // 1) Wait for the restored project to resolve into the active solution, then run
            //    scaffold -> Generate UI -> SetProfile on the real service objects.
            const gen = await l.win.evaluate(
                async ({ projectMatch, concept, serverUrl, token }) =>
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
                            for (const [, e] of (p._cache ?? new Map()))
                            {
                                const n = (e as any)?.constructor?.name
                                if (n && !(n in map)) map[n] = e
                            }
                        return map
                    }
                    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

                    // Contributors are lazy — not in the service cache until something asks the
                    // HierarchyContributorRegistry for the 'project' family. For(key) resolves +
                    // caches them, so we drive the exact instances the context menu would.
                    const byCtor = (list: any[], name: string): any => list.find((c) => c?.constructor?.name === name)
                    let member: any, svc: Record<string, any> = {}, genContrib: any, pubContrib: any
                    const deadline = Date.now() + 60_000
                    for (;;)
                    {
                        const root = findRoot()
                        svc = services(root)
                        const mgr = svc['SolutionManagerService']
                        const reg = svc['HierarchyContributorRegistry']
                        const members = mgr?.ActiveSolution?.Members?.ToArray?.() ?? []
                        member = members.filter((m: any) => m.Storage !== undefined)
                            .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes(projectMatch))
                        if (member && reg)
                        {
                            const projContribs = reg.For('project') ?? []
                            genContrib = byCtor(projContribs, 'GenerateUiContributor')
                            pubContrib = byCtor(projContribs, 'PublishTenantContributor')
                        }
                        if (member && genContrib && pubContrib) break
                        if (Date.now() > deadline) return { ok: false, stage: 'resolve', have: Object.keys(svc), memberFound: !!member, gen: !!genContrib, pub: !!pubContrib }
                        await sleep(500)
                    }

                    const mutations = svc['SolutionWorkspaceService']
                    const storage = member.Storage
                    const title = member.Title ?? 'tasks-app'

                    // Base scaffold first (idempotent) so Generate UI merges concept UI into the
                    // scaffolded app root — the proven order from the automated capstone.
                    await mutations.EnsureMemberGenerated(member)

                    // Real Generate UI command, non-interactive: stub the concept prompt + the
                    // completion reporter on the constructed command instance.
                    const cmd: any = genContrib.Create()
                    cmd.selection = { Select: async () => concept }
                    cmd.reporter = { Report: async () => {}, ReportFailure: async (_c: string, e: unknown) => { throw e } }
                    await cmd.Run(storage, title)

                    // Configure the publish profile straight on the real publisher (skips the dialog).
                    const publisher = pubContrib.publisher
                    if (!publisher) return { ok: false, stage: 'publisher-missing' }
                    await publisher.SetProfile(serverUrl, token)

                    return { ok: true, root: String(storage.Root), title }
                },
                { projectMatch: 'sp1-smoke', concept: CONCEPT, serverUrl: SERVER_URL, token },
            )
            expect(gen, JSON.stringify(gen)).toMatchObject({ ok: true })

            // Generation wrote into the project on disk: base scaffold (generated/ + src/app.mu)
            // plus the per-concept UI under src/ui/Task (list + form + CRUD view-model).
            expect(existsSync(path.join(PROJECT_DIR, 'src/app.mu')), 'src/app.mu missing').toBeTruthy()
            expect(existsSync(path.join(PROJECT_DIR, 'src/ui/Task/list.mu')), 'src/ui/Task/list.mu missing').toBeTruthy()
            expect(existsSync(path.join(PROJECT_DIR, 'src/ui/Task/form.mu')), 'src/ui/Task/form.mu missing').toBeTruthy()
            expect(existsSync(path.join(PROJECT_DIR, 'src/ui/Task/Task-vm.ts')), 'src/ui/Task/Task-vm.ts missing').toBeTruthy()

            // 2) Invoke the real Publish command (build html-bundle-remote -> IPC deploy) and
            //    capture its outcome by wrapping the publisher + build service.
            await l.win.evaluate(() =>
            {
                const S = Symbol.for('mural:visual-backref')
                let root: any
                for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v && v.Services) { root = v; break } }
                const svc: Record<string, any> = {}
                for (let p = root?.Services; p; p = p._parent)
                    for (const [, e] of (p._cache ?? new Map())) { const n = (e as any)?.constructor?.name; if (n && !(n in svc)) svc[n] = e }
                const mgr = svc['SolutionManagerService']
                const member = (mgr?.ActiveSolution?.Members?.ToArray?.() ?? []).filter((m: any) => m.Storage)
                    .find((m: any) => String(m.Storage.Root ?? '').toLowerCase().includes('sp1-smoke'))
                const projContribs = svc['HierarchyContributorRegistry'].For('project') ?? []
                const pub = projContribs.find((c: any) => c?.constructor?.name === 'PublishTenantContributor')
                const state: any = (window as any).__sp1smoke = { log: [] }
                const origBuild = pub.buildService.Build.bind(pub.buildService)
                pub.buildService.Build = async (...a: any[]) =>
                {
                    state.log.push('build:start')
                    try { const r = await origBuild(...a); state.build = { ok: r.Result.Ok, outputPath: r.Result.OutputPath, diags: r.Result.Ok ? undefined : r.Result.Diagnostics }; state.log.push('build:done ok=' + r.Result.Ok); return r }
                    catch (e) { state.buildError = String((e as any)?.stack ?? e); state.log.push('build:error'); throw e }
                }
                const origPub = pub.publisher.Publish.bind(pub.publisher)
                pub.publisher.Publish = async (dir: string) =>
                {
                    state.publishStarted = true
                    state.log.push('publish:start ' + dir)
                    try { const r = await origPub(dir); state.publish = r; state.log.push('publish:done ' + JSON.stringify(r)); return r }
                    catch (e) { state.publishError = String((e as any)?.stack ?? e); state.log.push('publish:error'); throw e }
                }
                try { pub.publish(member) } catch (e) { state.invokeError = String(e) }
            })

            // Wait for any terminal signal (build error, publish result/error, or invoke error);
            // build:done without a publish signal means the IPC deploy stalled — logged below.
            await l.win.waitForFunction(() =>
            {
                const s: any = (window as any).__sp1smoke
                return !!(s && (s.publish || s.publishError || s.buildError || s.invokeError))
            }, undefined, { timeout: 150_000 }).catch(() => {})

            const outcome = await l.win.evaluate(() => (window as any).__sp1smoke)
            console.log('[sp1-smoke] log:', JSON.stringify(outcome.log))
            console.log('[sp1-smoke] build:', JSON.stringify(outcome.build))
            console.log('[sp1-smoke] publishStarted:', outcome.publishStarted, 'publish:', JSON.stringify(outcome.publish))
            if (outcome.buildError) console.log('[sp1-smoke] buildError:', String(outcome.buildError).slice(0, 1500))
            if (outcome.publishError) console.log('[sp1-smoke] publishError:', String(outcome.publishError).slice(0, 1500))
            if (outcome.invokeError) console.log('[sp1-smoke] invokeError:', outcome.invokeError)

            expect(outcome.buildError, outcome.buildError).toBeUndefined()
            expect(outcome.build?.ok, `build diagnostics: ${JSON.stringify(outcome.build?.diags)}`).toBeTruthy()
            expect(outcome.publishError, outcome.publishError).toBeUndefined()
            expect(outcome.publish?.Status, `publish: ${JSON.stringify(outcome.publish)}`).toBe('applied')

            console.log('[sp1-smoke] deploy Applied — Plexus published', CONCEPT, 'to', SERVER_URL)
        }
        finally
        {
            const appErrs = l.errors.filter((e) => !/Insecure Content-Security-Policy|Electron Security Warning|devtools|Autofill\./i.test(e))
            if (appErrs.length) console.log('[sp1-smoke] renderer errors:\n' + appErrs.slice(0, 20).join('\n'))
            await l.app.close().catch(() => {})
            restore()
        }
    })
})
