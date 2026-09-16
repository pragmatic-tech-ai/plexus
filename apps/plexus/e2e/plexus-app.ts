// Reusable Electron launch + introspection helper for Plexus e2e tests.
//
// Plexus renders through mural, which paints Visuals to an SVG tree; every
// rendered SVG element carries a back-reference to its Visual under
// Symbol.for('mural:visual-backref'). The root Visual is the `EditorShell`
// (exposes `.Services` and `.DataContext`). These helpers reach that tree so
// tests can introspect the live app (figure counts, service graph, problems)
// and locate visuals to click by type/label without brittle CSS selectors.
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

export const PLEXUS_ROOT = path.resolve(__dirname, '..')
export const MAIN = path.join(PLEXUS_ROOT, 'out/main/index.js')
export const ELECTRON_EXE = path.join(PLEXUS_ROOT, 'node_modules/electron/dist/electron.exe')

// Live corpus of test projects (meta-model + two libraries + arch consumer).
// Override the root with PLEXUS_TEST_CORPUS if it lives elsewhere.
const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
export const TEST_PROJECTS = [
    path.join(CORPUS, 'meta-models/tech-architecture'),
    path.join(CORPUS, 'libraries/microsoft'),
    path.join(CORPUS, 'libraries/aws'),
    path.join(CORPUS, 'architecures/test_architecture'),
]

// Electron default userData (no productName override → "Electron").
const SESSION_FILE = path.join(os.homedir(), 'AppData/Roaming/Electron/open-projects.json')

export function corpusAvailable(): boolean {
    return fs.existsSync(MAIN) && fs.existsSync(ELECTRON_EXE) && TEST_PROJECTS.every((p) => fs.existsSync(p))
}

// Seed the restore-session file with the given projects; returns a restore()
// that puts the previous contents back (call in afterAll).
export function seedSession(projects: string[] = TEST_PROJECTS): () => void {
    const prev = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8') : null
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true })
    fs.writeFileSync(SESSION_FILE, JSON.stringify(projects))
    return () => {
        if (prev === null) fs.rmSync(SESSION_FILE, { force: true })
        else fs.writeFileSync(SESSION_FILE, prev)
    }
}

// Relative project paths under the corpus root — used to clone the corpus into a
// throwaway temp dir so a test can mutate it (autosave, generated fixtures)
// without ever touching the real corpus.
export const PROJECT_RELS = [
    'meta-models/tech-architecture',
    'libraries/microsoft',
    'libraries/aws',
    'architecures/test_architecture',
]

// Clone the corpus projects into a fresh temp dir. Returns the clone root (remove
// it in afterAll), the cloned project dirs (pass to seedSession), and the arch
// project dir (where diagram fixtures live).
export function cloneCorpus(): { root: string; projects: string[]; archDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-corpus-'))
    const projects: string[] = []
    for (const rel of PROJECT_RELS) {
        const dst = path.join(root, rel)
        fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
        projects.push(dst)
    }
    return { root, projects, archDir: path.join(root, 'architecures/test_architecture') }
}

// Write the `containment-demo.diagram` fixture into a corpus CLONE's arch project.
// It places the `on_premises` location plus its two `in = on_premises` children
// (component `enterprise_legacy_app`, network `on_prem_network`) — all entities in
// landscape.todl. On open, the containment projection realizes `on_premises` as a
// ContentContainerFigure and nests the two children straight from the model refs,
// with no model mutation. The children sit inside the container's bounds so the
// reparent keeps them there. Kept out of the real corpus (never mutated) and
// generated per-run instead. A fourth node (`m365_copilot_chat`, a component with
// no `in` ref) is placed OUTSIDE the container as a loose node — the drag-in test
// nests it at runtime (component→location containment is legal, same as the
// enterprise_legacy_app child).
export function writeContainmentDemoFixture(archDir: string): void {
    const diagram = {
        version: 3,
        nodes: [
            { id: 'on_premises', type: 'arch', data: {} },
            { id: 'enterprise_legacy_app', type: 'arch', data: {} },
            { id: 'on_prem_network', type: 'arch', data: {} },
            { id: 'm365_copilot_chat', type: 'arch', data: {} },
        ],
        visuals: {
            on_premises: { left: 180, top: 140, w: 380, h: 320, baseWidth: 380, baseHeight: 320 },
            enterprise_legacy_app: { left: 240, top: 230, w: 150, h: 80, baseWidth: 150, baseHeight: 80 },
            on_prem_network: { left: 240, top: 340, w: 150, h: 80, baseWidth: 150, baseHeight: 80 },
            m365_copilot_chat: { left: 640, top: 200, w: 150, h: 80, baseWidth: 150, baseHeight: 80 },
        },
    }
    fs.writeFileSync(path.join(archDir, 'containment-demo.diagram'), JSON.stringify(diagram, null, 1))
}

// Write the `nesting-demo.diagram` fixture: a 4-level MODEL-BACKED nest —
// azure ⊃ m365 ⊃ power_platform ⊃ business_agent. The three locations
// (microsoft_tech.*) carry a `parent` chain in the microsoft library
// (m365.parent = azure, power_platform.parent = m365); once the tech-architecture
// meta-model annotates `location.parent` @containment, that chain projects as
// nesting. `business_agent` is a component with `in = microsoft_tech.power_platform`,
// so it nests as the leaf. Each location is a container concept (target of
// `component.in`) → realizes as a ContentContainerFigure, exercising the
// re-mint-at-depth path. Nodes are placed at diagram-space coords that are visually
// nested; membership itself comes from the model (projectContainment), not geometry.
export function writeNestingFixture(archDir: string): void {
    const diagram = {
        version: 3,
        nodes: [
            { id: 'microsoft_tech.azure', type: 'arch', data: {} },
            { id: 'microsoft_tech.m365', type: 'arch', data: {} },
            { id: 'microsoft_tech.power_platform', type: 'arch', data: {} },
            { id: 'business_agent', type: 'arch', data: {} },
        ],
        visuals: {
            'microsoft_tech.azure': { left: 100, top: 100, w: 600, h: 480, baseWidth: 600, baseHeight: 480, userSized: true },
            'microsoft_tech.m365': { left: 140, top: 170, w: 440, h: 360, baseWidth: 440, baseHeight: 360, userSized: true },
            'microsoft_tech.power_platform': { left: 180, top: 240, w: 280, h: 240, baseWidth: 280, baseHeight: 240, userSized: true },
            business_agent: { left: 210, top: 300, w: 150, h: 80, baseWidth: 150, baseHeight: 80 },
        },
    }
    fs.writeFileSync(path.join(archDir, 'nesting-demo.diagram'), JSON.stringify(diagram, null, 1))
}

export interface Launched {
    app: ElectronApplication
    win: Page
    errors: string[]
    warnings: string[]
}

// Launch the built app as a GUI (ELECTRON_RUN_AS_NODE must be stripped, or
// Electron runs as a plain node process and never opens a window). Collects
// renderer console.error + uncaught page errors into `errors`.
export async function launchPlexus(): Promise<Launched> {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({ executablePath: ELECTRON_EXE, args: [MAIN], cwd: PLEXUS_ROOT, env })
    const win = await app.firstWindow()
    const errors: string[] = []
    const warnings: string[] = []
    win.on('console', (m) => {
        const t = m.type()
        if (t === 'error') errors.push(m.text())
        else if (t === 'warning') warnings.push(m.text())
    })
    win.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack ?? e.message)))
    await win.waitForLoadState('domcontentloaded').catch(() => {})
    return { app, win, errors, warnings }
}

// Renderer errors that are environmental noise, not app faults.
const IGNORABLE = [
    /Insecure Content-Security-Policy/i,
    /Electron Security Warning/i,
    /devtools/i,
    /Autofill\./i,
]
export function appErrors(errors: string[]): string[] {
    return errors.filter((e) => !IGNORABLE.some((re) => re.test(e)))
}

// ── Visual-tree introspection (runs in the renderer) ──────────────────────

// Histogram of Visual constructor names across the whole rendered tree, plus
// the root Visual's ctor and whether it exposes a service provider.
export async function snapshot(win: Page): Promise<{
    totalEls: number
    visualCount: number
    rootCtor: string | undefined
    hasServices: boolean
    ctorHisto: Record<string, number>
    problemsText: string | undefined
    bodyText: string
}> {
    return win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        const histo: Record<string, number> = {}
        let visualCount = 0
        let root: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v) continue
            visualCount++
            if (!root) root = v
            const n = v.constructor?.name
            if (n) histo[n] = (histo[n] ?? 0) + 1
        }
        const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
        // The status-bar problems pill reads "No problems" or "N problems".
        const pm = bodyText.match(/(No problems|\d+\s+problems?)/i)
        return {
            totalEls: document.querySelectorAll('*').length,
            visualCount,
            rootCtor: root?.constructor?.name,
            hasServices: !!(root && root.Services),
            ctorHisto: histo,
            problemsText: pm?.[0],
            bodyText: bodyText.slice(0, 2000),
        }
    })
}

export async function countByCtor(win: Page, ctor: string): Promise<number> {
    return win.evaluate((c) => {
        const S = Symbol.for('mural:visual-backref')
        let n = 0
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v && v.constructor?.name === c) n++
        }
        return n
    }, ctor)
}

// Bounding rects (viewport coords) of every visual whose ctor matches, in DOM
// order. Optionally filter by the visual's rendered text (innerText of its
// element). Used to click by Visual type instead of a fragile selector.
export async function rectsForCtor(
    win: Page,
    ctor: string,
    labelIncludes?: string,
): Promise<Array<{ x: number; y: number; w: number; h: number; text: string }>> {
    return win.evaluate(
        ({ ctor, labelIncludes }) => {
            const S = Symbol.for('mural:visual-backref')
            const out: Array<{ x: number; y: number; w: number; h: number; text: string }> = []
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]
                if (!v || v.constructor?.name !== ctor) continue
                const r = (el as Element).getBoundingClientRect()
                if (r.width === 0 || r.height === 0) continue
                const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()
                if (labelIncludes && !text.toLowerCase().includes(labelIncludes.toLowerCase())) continue
                out.push({ x: r.x, y: r.y, w: r.width, h: r.height, text })
            }
            return out
        },
        { ctor, labelIncludes },
    )
}

export async function clickCenter(win: Page, r: { x: number; y: number; w: number; h: number }): Promise<void> {
    await win.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
}
