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
const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'c:/Users/Eugene/Projects/architecture-agent/plexus_test_projects'
const PROJECT_RELS = [
    'meta-models/tech-architecture',
    'libraries/microsoft',
    'libraries/aws',
    'architecures/test_architecture',
]

async function probeIcons(l: Launched)
{
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        const elByVisual = new Map<any, Element>()
        const parts: any[] = []
        let diagram: any
        for (const el of document.querySelectorAll('*'))
        {
            const v = (el as any)[S]
            if (!v) continue
            if (!elByVisual.has(v)) elByVisual.set(v, el)
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        // Map each ArchNodeVM's Icon (its EntityIconVM instance) → node id + role, so
        // a PART_Icon can be attributed to its owning node. The icon's string IconKey
        // is no longer populated (icons resolve through TodlVisualSelector), so a
        // specific node's icon is located by the EntityIconVM IDENTITY, not by key.
        const nodes: any[] = []
        const iconToNode = new Map<any, { id: string; isContainer: boolean }>()
        const arr: any[] = diagram?.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        for (const vm of arr)
        {
            if (vm?.constructor?.name !== 'ArchNodeVM') continue
            nodes.push({ id: vm.Id, isContainer: vm.IsContainer, iconCtor: vm.Icon?.constructor?.name, iconKey: vm.Icon?.IconKey })
            if (vm.Icon !== undefined) iconToNode.set(vm.Icon, { id: vm.Id, isContainer: !!vm.IsContainer })
        }
        // Every ContentControl named PART_Icon (the canvas node's icon host).
        for (const [v, el] of elByVisual)
        {
            if (v?.Name !== 'PART_Icon') continue
            const r = (el as Element).getBoundingClientRect()
            const content = v.Content
            const owner = content !== undefined ? iconToNode.get(content) : undefined
            const images = el.querySelectorAll('image').length
            const paths = el.querySelectorAll('path').length
            const svgLeaves = el.querySelectorAll('image,path,use,rect,circle').length
            parts.push({
                nodeId: owner?.id,
                isContainer: owner?.isContainer,
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
        // What does the live ApplicationSettings return for the icon-size keys?
        // (main.js exposes __getSetting = (k) => ApplicationSettings.Get(k).)
        const gs = (window as any).__getSetting as ((k: string) => unknown) | undefined
        const settings = gs
            ? {
                  hasGetter: true,
                  defaultIconWidth: gs('diagram.DefaultIconWidth'),
                  defaultIconHeight: gs('diagram.DefaultIconHeight'),
                  toolboxItemWidth: gs('toolbox.item.width'),   // known-working control
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
        for (const rel of PROJECT_RELS)
        {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        writeNestingFixture(path.join(copyRoot, 'architecures/test_architecture'))
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open through the workspace service — the nested solution tree keeps project
        // nodes collapsed, so a tree double-click can't see the file row.
        const { rectsForCtor, clickCenter, openProjectFile } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        await openProjectFile(l, 'test_architecture', 'nesting-demo.diagram')
        for (let i = 0; i < 40 && (await probeIcons(l)).nodes.length === 0; i++) await l.win.waitForTimeout(500)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('a leaf arch node renders its icon at the settings-driven size (regression: SettingSourceKey bridge)', async () => {
        // The leaf node's class icon paints asynchronously after the nodes project,
        // so poll for business_agent's PART_Icon to render a glyph.
        const leafOf = (d: Awaited<ReturnType<typeof probeIcons>>): any =>
            d.parts.find((p: any) => p.nodeId === 'business_agent')
        let data = await probeIcons(l)
        for (let i = 0; i < 40 && !(leafOf(data)?.paths > 0); i++)
        {
            await l.win.waitForTimeout(500)
            data = await probeIcons(l)
        }
        await l.win.screenshot({ path: path.join(ART, 'icon-probe.png') }).catch(() => {})
        fs.writeFileSync(path.join(ART, 'icon-probe.json'), JSON.stringify(data, null, 2))
        console.log('ICON-PROBE ' + JSON.stringify(data))
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])

        // The leaf arch node (business_agent, a component — not a container) must
        // paint its class icon at the ~80px settings size, with real glyph geometry.
        // widthProp === 80 proves the DP resolved Diagram.DefaultIconWidth from the
        // setting via the SettingSourceKey bridge — a default (0) would collapse it,
        // which is the exact regression (bridge unwired when app.mu owns
        // ApplicationSettings.Key). This is the user-facing guarantee, asserted on the
        // rendered result rather than a debug seam. The icon is located by its owning
        // node (its EntityIconVM identity), since the string IconKey is no longer
        // populated — icons resolve through TodlVisualSelector.
        const leaf = leafOf(data)
        expect(leaf, 'business_agent PART_Icon present').toBeTruthy()
        expect(leaf.isContainer, 'business_agent is a leaf (non-container)').toBe(false)
        expect(leaf.widthProp, 'icon ContentControl width = Diagram.DefaultIconWidth (80)').toBe(80)
        expect(leaf.rect.w, 'icon laid out at a real size, not collapsed').toBeGreaterThan(40)
        expect(leaf.paths, 'icon glyph actually rendered').toBeGreaterThan(0)
    })
})
