// Drives the REAL media-drop path in the running app: opens an empty diagram and
// fires an OS file drop through diagram._fireExternalDropped — the same entry
// canvas-drop-behavior uses for OS drops — with a synthesized 1×1 PNG File. The
// PlexusDiagramDocument wiring classifies + embeds it and adds a MediaNodeVM.
// Then it saves (Ctrl+S) and re-reads the .diagram from disk to prove the media
// node round-trips (type 'media' + an embedded data: URI source).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, cloneCorpus, clickCenter, rectsForCtor, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

// A 1×1 transparent PNG — a valid image so the renderer decodes its natural size.
const PNG_1x1_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const FIXTURE = 'a-media-drop-demo.diagram'   // sorts to the top of the project files
function writeMediaDropFixture(archDir: string): void {
    fs.writeFileSync(
        path.join(archDir, FIXTURE),
        JSON.stringify({ version: 3, nodes: [], visuals: {} }, null, 1),
    )
}

async function diagramOpen(l: Launched): Promise<boolean> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') return true
        }
        return false
    })
}

async function openByName(l: Launched, name: string): Promise<boolean> {
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1200)
    const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
    for (let attempt = 0; attempt < 4; attempt++) {
        for (let i = 0; i < 60; i++) {
            if (await l.win.getByText(name, { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 300)
            await l.win.waitForTimeout(150)
        }
        const dd = l.win.getByText(name, { exact: true }).first()
        if (await dd.count()) {
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            for (let w = 0; w < 16; w++) {
                await l.win.waitForTimeout(700)
                if (await diagramOpen(l)) return true
            }
        }
        await l.win.mouse.move(scrollX, 300)
        await l.win.mouse.wheel(0, -4000)
        await l.win.waitForTimeout(400)
    }
    return diagramOpen(l)
}

// Fire an OS file drop of a PNG at (x,y). Builds a File in page context and calls
// the diagram's ExternalDropped fire helper. Returns whether the diagram + fire
// method were found.
async function fireMediaDrop(l: Launched, base64: string, x: number, y: number): Promise<{ fired: boolean }> {
    return l.win.evaluate(({ base64, x, y }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        if (!diagram || typeof diagram._fireExternalDropped !== 'function') return { fired: false }
        const bin = atob(base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], 'e2e.png', { type: 'image/png' })
        diagram._fireExternalDropped({ Files: [file], Uris: [], Position: { X: x, Y: y }, TargetContainer: undefined })
        return { fired: true }
    }, { base64, x, y })
}

// Count MediaNodeVM instances in the live diagram's items, and grab the first
// one's kind + whether its Source is an embedded data URI.
async function mediaProbe(l: Launched): Promise<{ count: number; kind?: string; sourceIsData?: boolean }> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        const arr: any[] = diagram?.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        const media = arr.filter((vm) => vm?.constructor?.name === 'MediaNodeVM')
        const first = media[0]
        return {
            count: media.length,
            kind: first?.MediaKind,
            sourceIsData: typeof first?.Source === 'string' && first.Source.startsWith('data:image'),
        }
    })
}

test.describe.serial('media drop onto a diagram', () => {
    let l: Launched
    let restoreSession: () => void
    let cloneRoot: string
    let archDir: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        const clone = cloneCorpus()
        cloneRoot = clone.root
        archDir = clone.archDir
        writeMediaDropFixture(archDir)
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        await openByName(l, FIXTURE)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('drops an image file, creating a persisted media node', async () => {
        expect(await diagramOpen(l)).toBe(true)
        const errBefore = l.errors.length

        const res = await fireMediaDrop(l, PNG_1x1_BASE64, 300, 240)
        expect(res.fired).toBe(true)
        // Async: buildMediaNode awaits File.arrayBuffer() + bitmap decode.
        await l.win.waitForTimeout(4000)

        const probe = await mediaProbe(l)
        // eslint-disable-next-line no-console
        console.log('media probe:', JSON.stringify(probe))
        expect(probe.count).toBe(1)
        expect(probe.kind).toBe('image')
        expect(probe.sourceIsData).toBe(true)

        // Persist and verify the on-disk .diagram carries the media node.
        await l.win.keyboard.press('Control+S')
        await l.win.waitForTimeout(2500)
        const raw = fs.readFileSync(path.join(archDir, FIXTURE), 'utf8')
        fs.writeFileSync(path.join(ART, 'media-drop.diagram.json'), raw)
        const saved = JSON.parse(raw)
        const mediaNodes = (saved.nodes ?? []).filter((n: { type?: string }) => n.type === 'media')
        expect(mediaNodes.length).toBe(1)
        expect(String(mediaNodes[0].data?.source ?? '')).toMatch(/^data:image/)

        expect(appErrors(l.errors.slice(errBefore))).toEqual([])
    })
})
