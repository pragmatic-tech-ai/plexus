// Regression: styling an arch node (label text style AND card fill via Format
// Shape) must mark the document dirty so the change is actually saved. Before the
// dirty-tracking fix, a content VM's style edit left IsDirty false → the Save
// command stayed disabled and the style was lost. Runs against a corpus CLONE so
// the save hits the copy, then reads the written .diagram file to confirm both
// the label style and the card fill round-trip to disk.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, rectsForCtor, clickCenter, cloneCorpus, type Launched } from './plexus-app'

async function canvasFigs(l: Launched) {
    return (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 60).sort((a, b) => a.y - b.y || a.x - b.x)
}

// Select the first arch node on the active document, style its label + card
// through the real Format channels, then read IsDirty / SaveCommand and fire the
// dirty-gated save.
function styleArchNodeAndSave(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any
        for (let p = root?.Services; p && !host; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) { if ((e as any)?.constructor?.name === 'DocumentsContentHostService') { host = e; break } }
        }
        const doc = host?.ActiveDocument
        const view = doc?.ActiveView
        if (!doc || !view) return { ok: false, reason: 'no active doc/view' }
        const items = view.ItemsSource?.ToArray ? view.ItemsSource.ToArray() : []
        const vm = items.find((i: any) => i?.constructor?.name === 'ArchNodeVM')
        const container = vm ? view.Generator?.ContainerFromItem(vm) : undefined
        if (!container) return { ok: false, reason: 'no arch container' }
        view.HandleContainerClick(container, 0)

        // Label text style (routes to the VM's TextStyle) + card fill (routes to the
        // container Figure) — both through FormatMirror, exactly as the UI does.
        view.SelectionFontSize = 30
        const B = container.Fill?.constructor, C = container.Fill?.Color?.constructor
        if (B && C) view.SelectionFormatFill = new B(C.FromHex('#ff0000'))

        const dirtyAfter = doc.IsDirty
        const canSave = doc.SaveCommand?.CanExecute?.() ?? null
        if (canSave) doc.SaveCommand.Execute()   // dirty-gated save
        return {
            ok: true,
            id: vm.Id,
            dirtyAfter,
            canSave,
            vmFontSize: vm.LabelFontSize,
            containerFill: container.Fill?.Color?.ToHex?.().toLowerCase().slice(0, 7),
        }
    })
}

test.describe.serial('arch node style is saved (dirty-tracking)', () => {
    let l: Launched
    let restore: () => void
    let cloneRoot: string
    let archDir: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        const clone = cloneCorpus()
        cloneRoot = clone.root
        archDir = clone.archDir
        restore = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 22; i++) {
            if (await l.win.getByText('diagram.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(300)
        }
        let figs: Awaited<ReturnType<typeof canvasFigs>> = []
        for (let a = 0; a < 5 && figs.length === 0; a++) {
            const dd = l.win.getByText('diagram.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(4000)
            figs = await canvasFigs(l)
        }
        expect(figs.length, 'diagram opened').toBeGreaterThan(0)
    })

    test.afterAll(async () => {
        await l.app.close().catch(() => {})
        restore?.()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('styling an arch node dirties the doc, enables Save, and persists to disk', async () => {
        const r = await styleArchNodeAndSave(l)
        expect(r.ok, `styled an arch node: ${JSON.stringify(r)}`).toBe(true)
        // The edits reached the model.
        expect(r.vmFontSize, `label font size applied (=${r.vmFontSize})`).toBe(30)
        expect(r.containerFill, `card fill applied (=${r.containerFill})`).toBe('#ff0000')
        // The core fix: the style edit marked the document dirty and enabled Save.
        expect(r.dirtyAfter, 'style edit dirtied the document').toBe(true)
        expect(r.canSave, 'Save command enabled after a style edit').toBe(true)

        // The save actually wrote both to disk.
        await l.win.waitForTimeout(2000)
        const raw = fs.readFileSync(path.join(archDir, 'diagram.diagram'), 'utf8')
        const doc = JSON.parse(raw) as { nodes: Array<{ id: string; data: any }>; visuals: Record<string, any> }
        const rec = doc.nodes.find((n) => n.id === r.id)!
        expect(rec.data?.labelStyle?.fontSize, `labelStyle.fontSize saved (${JSON.stringify(rec.data)})`).toBe(30)
        expect((doc.visuals[r.id!]?.fill ?? '').toLowerCase(), `card fill saved (${JSON.stringify(doc.visuals[r.id!])})`).toBe('#ff0000')
    })
})
