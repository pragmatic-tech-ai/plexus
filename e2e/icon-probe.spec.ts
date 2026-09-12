// DIAGNOSTIC PROBE (not a pass/fail gate): why are canvas arch-node icons blank?
// Opens the nesting fixture (has the leaf component `business_agent` + container
// locations) and dumps, for every PART_Icon ContentControl on the canvas: its laid-
// out size, its bound Content (EntityIconVM) + IconKey, whether a ContentTemplate-
// Selector is wired, and how many <image>/<path> SVG leaves actually rendered under
// it. This tells us WHICH layer is empty (size 0 / no content / no IconKey / no
// rendered glyph) instead of guessing.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, writeNestingFixture, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture',
    'libraries/microsoft',
    'libraries/aws',
    'architecures/test_architecture',
]

async function probeIcons(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        const elByVisual = new Map<any, Element>()
        const parts: any[] = []
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v) continue
            if (!elByVisual.has(v)) elByVisual.set(v, el)
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        // Every ContentControl named PART_Icon (the canvas node's icon host).
        for (const [v, el] of elByVisual) {
            if (v?.Name !== 'PART_Icon') continue
            const r = (el as Element).getBoundingClientRect()
            const content = v.Content
            const images = el.querySelectorAll('image').length
            const paths = el.querySelectorAll('path').length
            const svgLeaves = el.querySelectorAll('image,path,use,rect,circle').length
            parts.push({
                rect: { w: Math.round(r.width), h: Math.round(r.height) },
                elTag: (el as Element).tagName,
                childElCount: (el as Element).childElementCount,
                contentCtor: content?.constructor?.name,
                iconKey: content?.IconKey,
                selectorCtor: v.ContentTemplateSelector?.constructor?.name,
                widthProp: v.Width,       // may be a number if resolved, or NaN/undefined
                heightProp: v.Height,
                images, paths, svgLeaves,
            })
        }
        // ArchNodeVMs and whether each carries an Icon EntityIconVM.
        const nodes: any[] = []
        const arr: any[] = diagram?.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        for (const vm of arr) {
            if (vm?.constructor?.name !== 'ArchNodeVM') continue
            nodes.push({
                id: vm.Id,
                isContainer: vm.IsContainer,
                iconCtor: vm.Icon?.constructor?.name,
                iconKey: vm.Icon?.IconKey,
            })
        }
        // What does the live ApplicationSettings return for the icon-size keys?
        // (main.js exposes __getSetting = (k) => ApplicationSettings.Get(k).)
        const gs = (window as any).__getSetting as ((k: string) => unknown) | undefined
        const gvs = (window as any).__getSettingViaSource as ((k: string) => unknown) | undefined
        const hasSrc = (window as any).__hasSettingSource as (() => boolean) | undefined
        const settings = gs
            ? {
                  hasGetter: true,
                  defaultIconWidth: gs('diagram.DefaultIconWidth'),
                  defaultIconHeight: gs('diagram.DefaultIconHeight'),
                  toolboxItemWidth: gs('toolbox.item.width'),   // known-working control
                  // Via the SettingSourceKey seam (what the DP tier actually uses):
                  viaSource_defaultIconWidth: gvs ? gvs('diagram.DefaultIconWidth') : 'no-fn',
                  settingSourceWiredToAppSettings: hasSrc ? hasSrc() : 'no-fn',
              }
            : { hasGetter: false }
        return { partCount: parts.length, parts, nodeCount: nodes.length, nodes, settings }
    })
}

test.describe.serial('canvas icon probe', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-iconprobe-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        writeNestingFixture(path.join(copyRoot, 'architecures/test_architecture'))
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 20; i++) {
            if (await l.win.getByText('nesting-demo.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const p = await probeIcons(l)
            if (p.nodeCount > 0) break
            const dd = l.win.getByText('nesting-demo.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('a leaf arch node renders its icon at the settings-driven size (regression: SettingSourceKey bridge)', async () => {
        await l.win.screenshot({ path: path.join(ART, 'icon-probe.png') }).catch(() => {})
        const data = await probeIcons(l)
        fs.writeFileSync(path.join(ART, 'icon-probe.json'), JSON.stringify(data, null, 2))
        console.log('ICON-PROBE ' + JSON.stringify(data))
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])

        // The DP SettingValue tier resolves via SettingSourceKey; app.mu registers
        // ApplicationSettings.Key itself, so main.js must wire the bridge or the DP
        // falls back to its default (0) and icons collapse.
        expect(data.settings.settingSourceWiredToAppSettings, 'SettingSourceKey must bridge to ApplicationSettings').toBe(true)
        expect(data.settings.viaSource_defaultIconWidth, 'Diagram.DefaultIconWidth resolves via the source seam').toBe(80)

        // The leaf arch node (business_agent, a component — not a container) must
        // paint its class icon at the ~80px settings size, with real glyph geometry.
        const leaf = data.parts.find((p: any) => p.iconKey === 'mm_icon_agent')
        expect(leaf, 'business_agent PART_Icon present with a resolved iconKey').toBeTruthy()
        expect(leaf.widthProp, 'icon ContentControl width = Diagram.DefaultIconWidth (80)').toBe(80)
        expect(leaf.rect.w, 'icon laid out at a real size, not collapsed').toBeGreaterThan(40)
        expect(leaf.paths, 'icon glyph actually rendered').toBeGreaterThan(0)
    })
})
