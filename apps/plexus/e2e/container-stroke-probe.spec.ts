// One-off diagnostic: dump the Fill/Stroke of a container figure vs a geometric
// shape, to see whether the container border uses the shape default stroke.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, cloneCorpus, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

async function dumpFigures(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram) return []
        const arr: any[] = diagram.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        const brush = (b: any) => (b == null ? null : (b.Color?.toString?.() ?? b.Color ?? b.toString?.() ?? String(b)))
        const pen = (p: any) => (p == null ? null : { brush: brush(p.Brush), thickness: p.Thickness })
        const out: any[] = []
        for (const vm of arr) {
            const fig = vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm)
            if (!fig) continue
            out.push({
                id: vm?.Id ?? fig?.Id,
                figure: fig?.constructor?.name,
                fill: brush(fig.Fill),
                stroke: pen(fig.Stroke),
            })
        }
        return out
    })
}

test.describe.serial('container stroke vs shape stroke', () => {
    let l: Launched
    let restoreSession: () => void
    let cloneRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        const clone = cloneCorpus()
        cloneRoot = clone.root
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 30; i++) {
            if (await l.win.getByText('diagram-2.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 300); await l.win.waitForTimeout(150)
        }
        for (let a = 0; a < 4 && (await dumpFigures(l)).length === 0; a++) {
            const dd = l.win.getByText('diagram-2.diagram', { exact: true }).first()
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('a container paints a visible default border (shape default stroke)', async () => {
        const figs = await dumpFigures(l)
        fs.writeFileSync(path.join(ART, 'container-stroke.json'), JSON.stringify(figs, null, 2))
        await l.win.screenshot({ path: path.join(ART, 'container-stroke.png') }).catch(() => {})
        // eslint-disable-next-line no-console
        console.log('FIGURES:', JSON.stringify(figs, null, 2))

        const containers = figs.filter((f) => f.figure === 'ContentContainerFigure')
        expect(containers.length, 'containers present').toBeGreaterThan(0)
        for (const c of containers) {
            // The container border is the shape default stroke: a visible (non-
            // transparent) pen at the shape default width (1.5), not the old
            // container-specific gray. Same brush the Figure ctor gives a shape.
            expect(c.stroke, `${c.id} has a stroke pen`).toBeTruthy()
            expect(c.stroke.thickness, `${c.id} stroke width = shape default`).toBe(1.5)
            expect(c.stroke.brush, `${c.id} stroke is not transparent`).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/)
        }
    })
})
