// Live check: the Format Shape Text page styles an ARCH node's label. An arch
// node's caption is its $Label tile (a TextBlock), not the container Figure's
// blank ShapeText, so FormatMirror must route the char/paragraph channels to the
// VM's TextStyle adapter (mural 0.24.0). Driving the Selection* DPs the Text page
// binds must (a) set the ArchNodeVM's Label* DPs and (b) change the rendered
// PART_Title TextBlock.
import { test, expect } from '@playwright/test'
import { launchPlexus, seedSession, corpusAvailable, rectsForCtor, clickCenter, appErrors, type Launched } from './plexus-app'

async function canvasFigs(l: Launched) {
    return (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 60).sort((a, b) => a.y - b.y || a.x - b.x)
}

// Select the first ArchNodeVM through the real selection path, then drive the
// Selection* DPs FormatMirror listens on. Returns the selected VM's resulting
// Label* state plus the rendered PART_Title FontSize.
function styleFirstArchNode(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        if (!diagram) return { ok: false, reason: 'no diagram' }
        const items = diagram.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        const vm = items.find((i: any) => i?.constructor?.name === 'ArchNodeVM')
        if (!vm) return { ok: false, reason: 'no arch node' }
        const container = diagram.Generator?.ContainerFromItem(vm)
        if (!container) return { ok: false, reason: 'no container' }
        diagram.HandleContainerClick(container, 0) // ModifierKeys.None

        // Drive the Text page's backing DPs (font size / bold / colour / alignment).
        diagram.SelectionFontSize = 26
        diagram.SelectionBold = true
        diagram.SelectionFontColorHex = '#ff0000'

        // Read the rendered label tile's FontSize (the TextBlock showing the label).
        let labelFontSize: number | undefined
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'TextBlock' && v.Text === vm.Label && vm.Label !== '') { labelFontSize = v.FontSize; break }
        }
        const fg = vm.LabelForeground
        return {
            ok: true,
            id: vm.Id,
            label: vm.Label,
            vmFontSize: vm.LabelFontSize,
            vmBold: vm.TextStyle.CurrentBold(),
            vmForegroundHex: fg?.Color?.ToHex?.().toLowerCase().slice(0, 7),
            labelFontSize,
        }
    })
}

test.describe.serial('arch node label responds to the Text page', () => {
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
    })

    test.afterAll(async () => { await l.app.close().catch(() => {}); restore?.() })

    test('a Text-page edit reaches the arch label VM and its rendered tile', async () => {
        const r = await styleFirstArchNode(l)
        expect(r.ok, `styled an arch node: ${JSON.stringify(r)}`).toBe(true)
        // FormatMirror routed the char edits onto the VM's Label* DPs.
        expect(r.vmFontSize, `LabelFontSize=${r.vmFontSize}`).toBe(26)
        expect(r.vmBold, 'LabelFontWeight reflects bold').toBe(true)
        expect(r.vmForegroundHex, `LabelForeground=${r.vmForegroundHex}`).toBe('#ff0000')
        // The `$LabelFontSize is set` trigger applied it to the rendered tile.
        expect(r.labelFontSize, `rendered PART_Title FontSize=${r.labelFontSize}`).toBe(26)
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
