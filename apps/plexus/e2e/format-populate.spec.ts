// Regression: the Format Shape (Style page) control must populate from the
// selected figure — and re-populate as the selection changes. The FillEditor's
// solid ColorPicker was wired one-way (seeded once at body-apply), so its swatch
// stayed stale on reselect even though the model tracked the new colour. This
// drives the real app: select a shape, read the ACTUAL PART_SolidColor picker
// (via the FillEditor's body root), then reselect a differently-filled shape and
// assert the swatch followed.
import { test, expect } from '@playwright/test'
import { launchPlexus, seedSession, corpusAvailable, rectsForCtor, clickCenter, type Launched } from './plexus-app'

async function canvasFigs(l: Launched) {
    return (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 60)
}
function selectByIndex(l: Launched, index: number) {
    return l.win.evaluate((index) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const items = diagram?.ItemsSource
        const item = items?.Get ? items.Get(index) : items?.[index]
        const container = diagram?.Generator?.ContainerFromItem(item)
        if (container) diagram.HandleContainerClick(container, 0)
        return item?.Fill?.Color?.ToHex?.() ?? null
    }, index)
}
async function clickInspectorTab(l: Launched, title: string) {
    const pt = await l.win.evaluate((title) => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'NavigationItem' && v.DataContext?.Title === title) {
                const r = (el as HTMLElement).getBoundingClientRect()
                if (r.width === 0 || r.height === 0) return null
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            }
        }
        return null
    }, title)
    if (pt) await l.win.mouse.click(pt.x, pt.y)
    return !!pt
}
// The FillEditor's own SolidColor + its live PART_SolidColor picker swatch. The
// picker lives in the swappable body's NameScope, so reach it via _bodyRoot.
function readFillEditor(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let fe: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'FillEditor') { fe = v; break } }
        if (!fe) return { ok: false as const }
        const picker = fe._bodyRoot?.FindName?.('PART_SolidColor')
        return {
            ok: true as const,
            variant: fe.Variant,
            solidColor: fe.SolidColor?.ToHex?.() ?? null,
            pickerHex: picker?.Color?.ToHex?.() ?? null,
        }
    })
}

test.describe.serial('Format Shape populates from the selected figure', () => {
    let l: Launched
    let restore: () => void

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        restore = seedSession()
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 16; i++) {
            if (await l.win.getByText('diagram.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(250)
        }
        let figs: any[] = []
        for (let a = 0; a < 4 && figs.length === 0; a++) {
            const dd = l.win.getByText('diagram.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
            figs = await canvasFigs(l)
        }
        expect(figs.length, 'diagram opened').toBeGreaterThan(0)
    })

    test.afterAll(async () => { await l.app.close().catch(() => {}); restore?.() })

    test('the solid colour picker reflects the selection, and follows a reselect', async () => {
        const fillA = await selectByIndex(l, 2)   // n10 (#123456)
        await l.win.waitForTimeout(1200)
        expect(await clickInspectorTab(l, 'Style'), 'Style tab').toBe(true)
        await l.win.waitForTimeout(1000)
        const a = await readFillEditor(l)
        expect(a.ok, 'FillEditor present').toBe(true)
        if (!a.ok) return
        expect(a.variant, 'solid variant').toBe('Solid')
        expect((a.solidColor ?? '').toLowerCase(), 'model tracks the fill').toBe((fillA ?? '').toLowerCase())
        expect((a.pickerHex ?? '').toLowerCase(), 'picker swatch matches the fill').toBe((fillA ?? '').toLowerCase())

        const fillB = await selectByIndex(l, 0)   // n8 (#bfdbfe)
        await l.win.waitForTimeout(1200)
        const b = await readFillEditor(l)
        expect(b.ok).toBe(true)
        if (!b.ok) return
        expect((b.pickerHex ?? '').toLowerCase(), 'picker swatch follows the reselect').toBe((fillB ?? '').toLowerCase())
        expect(fillB, 'the two shapes differ').not.toBe(fillA)
    })
})
