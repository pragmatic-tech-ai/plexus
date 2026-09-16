// Guards the Format Shape inspector's document binding. Two invariants:
//   1. The app starts with NO seeded document tabs (no "Untitled Diagram", no
//      scratch.md) — the content region is empty until the user opens a file.
//   2. Selecting a shape AUTO-OPENS the Format Shape panel bound to the ACTIVE
//      document, and an edit there reaches that document's figure.
//
// Regression this locks down: the auto-open behavior used to be hard-wired to a
// fixed seeded "Untitled Diagram". Editing a shape on a real project diagram
// then went to an inspector bound to the wrong (empty) document, so the whole
// Style page silently did nothing. attachAutoOpenInspector now follows
// host.ActiveDocument. See auto-open-inspector-behavior.ts.
import { test, expect } from '@playwright/test'
import { launchPlexus, seedSession, corpusAvailable, rectsForCtor, clickCenter, type Launched } from './plexus-app'

async function canvasFigs(l: Launched) {
    return (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 60).sort((a, b) => a.y - b.y || a.x - b.x)
}

function openDocTitles(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any
        for (let p = root?.Services; p && !host; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) {
                if (e?.constructor?.name === 'DocumentsContentHostService') { host = e; break }
            }
        }
        const docs = host?.OpenDocuments?.ToArray?.() ?? []
        return docs.map((d: any) => d?.Title ?? d?.constructor?.name)
    })
}

test('no seeded tabs at startup; auto-opened inspector edits the active diagram', async () => {
    test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
    const restore = seedSession()
    const l = await launchPlexus()
    try {
        await l.win.waitForTimeout(12_000)

        // (1) No Untitled Diagram / scratch.md tab at launch.
        const atStart = await openDocTitles(l)

        // Open the project diagram from the explorer.
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 14; i++) {
            if (await l.win.getByText('diagram.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        let figs: Awaited<ReturnType<typeof canvasFigs>> = []
        for (let attempt = 0; attempt < 3 && figs.length === 0; attempt++) {
            const dd = l.win.getByText('diagram.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
            figs = await canvasFigs(l)
        }
        expect(figs.length, 'diagram opened with canvas figures').toBeGreaterThan(0)

        // (2) Select a shape on the ACTIVE document's view (deterministic
        //     HandleContainerClick), which must AUTO-OPEN its Format Shape panel.
        const selected = await l.win.evaluate(() => {
            const S = Symbol.for('mural:visual-backref')
            let root: any
            for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
            let host: any
            for (let p = root?.Services; p && !host; p = p._parent) {
                for (const [, e] of (p._cache ?? new Map())) { if (e?.constructor?.name === 'DocumentsContentHostService') { host = e; break } }
            }
            const view = host?.ActiveDocument?.ActiveView
            if (!view) return false
            const items = view.ItemsSource ?? view.Items
            const item = items?.Get ? items.Get(0) : items?.[0]
            const container = view.Generator?.ContainerFromItem(item)
            if (container) view.HandleContainerClick(container, 0)
            return view.SelectionCount > 0
        })
        expect(selected, 'shape selected on the active view').toBe(true)
        await l.win.waitForTimeout(1500)

        // Drive the AUTO-OPENED inspector's Fill picker and confirm the ACTIVE
        // document's selected figure changes. Pick a colour distinct from the
        // current fill (robust to prior-run drift), then restore it so the
        // corpus fill stays put.
        const result = await l.win.evaluate(() => {
            const S = Symbol.for('mural:visual-backref')
            let root: any, fe: any, dock: any, host: any
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]; if (!v) continue
                if (!root) root = v
                if (v.constructor?.name === 'FillEditor' && !fe) fe = v
            }
            for (let p = root?.Services; p && (!dock || !host); p = p._parent) {
                for (const [, e] of (p._cache ?? new Map())) {
                    if (e?.constructor?.name === 'PanelDockService') dock = e
                    if (e?.constructor?.name === 'DocumentsContentHostService') host = e
                }
            }
            const diagram = host?.ActiveDocument?.ActiveView
            const sel = diagram?.SelectedItems?.[0]
            const cp = fe?._bodyRoot?.FindName?.('PART_SolidColor')
            const dockPanels = (dock?.Panels?.ToArray?.() ?? []).map((p: any) => p?.Id)
            const present = { fe: !!fe, sel: !!sel, cp: !!cp, dockPanels }
            if (!diagram || !fe || !sel || !cp) return { present }
            const ColorClass = (sel.Fill ?? fe.Fill)?.Color?.constructor
            const before = sel.Fill?.Color?.ToHex?.() ?? null
            const target = before === '#00cc00' ? '#ff3366' : '#00cc00'
            cp.Color = ColorClass.FromHex(target)
            const after = sel.Fill?.Color?.ToHex?.() ?? null
            // Restore the original fill so the corpus doesn't drift each run.
            if (before) cp.Color = ColorClass.FromHex(before)
            return { present, before, target, after }
        })

        expect(atStart.some((t: string) => /untitled/i.test(t) || /scratch/i.test(t)), 'no seeded tabs at startup').toBe(false)
        expect((result as any).present?.dockPanels, 'Format Shape auto-opened for the active diagram').toContain('diagram-format')
        expect((result as any).after, 'auto-opened inspector fill reaches the active figure').toBe((result as any).target)
    } finally {
        await l.app.close().catch(() => {})
        restore()
    }
})
