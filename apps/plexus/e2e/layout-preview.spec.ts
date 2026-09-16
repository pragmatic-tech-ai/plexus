// Live smoke for the layout preview overlay (mural 0.34.0):
//  - LayoutPipelineService.Preview() publishes a proposed arrangement on the
//    active diagram's Diagram.LayoutPreview WITHOUT moving figures.
//  - The framework mounts a LayoutPreviewAdorner into the canvas AdornerLayer and
//    paints it (opaque backdrop covering the canvas + a block per node).
//  - ApplyPreview() commits and clears the overlay; CancelPreview() just clears.
// Unit tests cover the service + adorner math headless; this proves the live
// deferred adorner mount + paint in the real Electron app.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, rectsForCtor, clickCenter, countByCtor, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

// Reach the root-registered LayoutPipelineService + the active diagram view, run
// one op, and report the resulting preview state.
function layoutOp(l: Launched, op: 'preview' | 'apply' | 'cancel') {
    return l.win.evaluate(({ op }) => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any, svc: any
        for (let p = root?.Services; p && (!host || !svc); p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) {
                const n = (e as any)?.constructor?.name
                if (n === 'DocumentsContentHostService') host = e
                if (n === 'LayoutPipelineService') svc = e
            }
        }
        const view = host?.ActiveDocument?.ActiveView
        if (!svc || !view) return { ok: false as const, reason: 'no service/view' }

        if (op === 'preview') svc.Preview()
        else if (op === 'apply') svc.ApplyPreview()
        else svc.CancelPreview()

        const p = view.LayoutPreview
        return {
            ok: true as const,
            previewActive: !!svc.PreviewActive,
            hasPreview: !!p,
            nodeCount: p?.nodes?.length ?? 0,
            edgeCount: p?.edges?.length ?? 0,
            status: svc.Status as string,
        }
    }, { op })
}

// After the deferred mount, read whether the overlay actually painted. The
// adorner self-paints (no child visuals), so we check: it's present, its
// RenderSize covers the canvas, and its SVG group contains the drawn primitives
// (backdrop rect + node blocks + edge lines).
function overlayPaint(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let el0: Element | undefined
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'LayoutPreviewAdorner') { el0 = el; break }
        }
        if (el0 === undefined) return { present: false, renderW: 0, renderH: 0, drawn: 0 }
        const v = (el0 as any)[S]
        return {
            present: true,
            renderW: v.RenderSize?.Width ?? 0,
            renderH: v.RenderSize?.Height ?? 0,
            drawn: el0.querySelectorAll('*').length,   // painted geometry elements
        }
    })
}

async function archNodeCount(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let n = 0
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v && v.constructor?.name === 'Figure' && v.Tag?.constructor?.name === 'ArchNodeVM') n++
        }
        return n
    })
}

test.describe.serial('layout preview overlay (live)', () => {
    let l: Launched
    let restoreSession: () => void

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        restoreSession = seedSession()
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 16; i++) {
            if (await l.win.getByText('diagram-2.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        for (let attempt = 0; attempt < 3 && (await archNodeCount(l)) === 0; attempt++) {
            const dd = l.win.getByText('diagram-2.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
    })

    test('Preview paints the overlay; Apply commits and clears it', async () => {
        expect(await archNodeCount(l), 'diagram opened with nodes').toBeGreaterThan(0)

        // Preview: publishes the arrangement + flips PreviewActive.
        const previewed = await layoutOp(l, 'preview')
        expect(previewed.ok, `layoutOp failed: ${(previewed as { reason?: string }).reason}`).toBe(true)
        expect(previewed.previewActive, 'preview is active').toBe(true)
        expect(previewed.hasPreview, 'LayoutPreview published on the view').toBe(true)
        expect(previewed.nodeCount, 'preview has node blocks').toBeGreaterThan(0)

        // Give the deferred adorner mount + first arrange a beat, then assert it painted.
        await l.win.waitForTimeout(600)
        await l.win.screenshot({ path: path.join(ART, 'preview-00-overlay.png') }).catch(() => {})
        const paint = await overlayPaint(l)
        expect(paint.present, 'LayoutPreviewAdorner mounted').toBe(true)
        expect(paint.renderW, 'overlay covers the canvas (non-zero width)').toBeGreaterThan(0)
        expect(paint.renderH, 'overlay covers the canvas (non-zero height)').toBeGreaterThan(0)
        expect(paint.drawn, 'overlay painted primitives (backdrop + blocks + edges)').toBeGreaterThan(0)

        // Apply: commits and tears the overlay down.
        const applied = await layoutOp(l, 'apply')
        expect(applied.previewActive, 'preview cleared after Apply').toBe(false)
        expect(applied.hasPreview, 'overlay removed from the view').toBe(false)
        // The overlay stops painting once its data is gone — poll (Apply also
        // kicks a full diagram re-layout, so the adorner's clearing render may
        // land a frame or two later). A stuck ghost would fail this.
        await expect.poll(async () => (await overlayPaint(l)).drawn, { timeout: 5000 })
            .toBe(0)

        // No app errors throughout.
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
        // (sanity) the adorner class did reach the tree at least once
        expect(await countByCtor(l.win, 'Diagram')).toBeGreaterThan(0)
    })

    test('Cancel clears a fresh preview without committing', async () => {
        const previewed = await layoutOp(l, 'preview')
        expect(previewed.previewActive).toBe(true)
        await l.win.waitForTimeout(400)

        const cancelled = await layoutOp(l, 'cancel')
        expect(cancelled.previewActive, 'preview cleared after Cancel').toBe(false)
        expect(cancelled.hasPreview, 'overlay removed after Cancel').toBe(false)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
