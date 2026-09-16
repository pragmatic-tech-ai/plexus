// Live end-to-end: a committed arch-node RENAME is one undo step that reverts
// BOTH the diagram label AND the persisted .todl on disk; redo replays it.
//
// This exercises the wiring the vitest suite can only approximate: the REAL
// ArchDiagramBindingService attaches a binding (registering the model history
// layer) on the REAL opened DiagramDocument; the rename commits through the REAL
// ArchModel over REAL file storage, writing a REAL .todl; undo restores the model
// layer and Reconcile re-saves — all in the launched Electron app against a corpus
// CLONE (never the real corpus).
//
// The rename is committed through the node VM's CommitEdit() and undo/redo through
// the document's Undo()/Redo(), rather than synthetic key/type events: mural reads
// keyboard through its own focus route, which Playwright cannot drive (see
// f2-title-edit.spec.ts — F2/typing are inert here). Every layer BELOW that input
// seam is the production path.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, rectsForCtor, clickCenter, cloneCorpus, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const PROBE = 'UndoProbe7391'
const shot = (l: Launched, name: string) =>
    l.win.screenshot({ path: path.join(ART, `${name}.png`) }).catch(() => {})

// Every arch node's label, resolved through its container Figure's Tag.
async function archNodes(l: Launched): Promise<Array<{ id: string; label: string }>> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        const out: Array<{ id: string; label: string }> = []
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v || v.constructor?.name !== 'Figure') continue
            const tag = v.Tag
            if (!tag || tag.constructor?.name !== 'ArchNodeVM') continue
            out.push({ id: tag.Id, label: tag.Label })
        }
        return out
    })
}

// Reach the live DiagramDocument (host.ActiveDocument) + its first ArchNodeVM,
// exactly as arch-style-persist does, and run one op against them. `rename`
// commits an in-place title edit (→ the binding's bracketed setField + save);
// `undo` / `redo` drive the document's history. Returns the label the diagram
// shows for that node afterwards, plus the history flags.
function onDoc(l: Launched, op: 'rename' | 'undo' | 'redo', probe: string) {
    return l.win.evaluate(({ op, probe }) => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any
        for (let p = root?.Services; p && !host; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) {
                if ((e as any)?.constructor?.name === 'DocumentsContentHostService') { host = e; break }
            }
        }
        const doc = host?.ActiveDocument
        const view = doc?.ActiveView
        if (!doc || !view) return { ok: false, reason: 'no active doc/view' }
        const firstArch = () => (view.ItemsSource?.ToArray ? view.ItemsSource.ToArray() : [])
            .find((i: any) => i?.constructor?.name === 'ArchNodeVM')
        const vm = firstArch()
        if (!vm) return { ok: false, reason: 'no arch node' }
        const id = vm.Id

        if (op === 'rename') {
            const before = vm.Label
            vm.BeginEdit(); vm.EditingLabel = probe; vm.CommitEdit()
            return { ok: true, id, before, label: vm.Label, canUndo: doc.History.CanUndo, canRedo: doc.History.CanRedo }
        }
        if (op === 'undo') doc.Undo(); else doc.Redo()
        const shown = (view.ItemsSource?.ToArray ? view.ItemsSource.ToArray() : [])
            .find((i: any) => i?.constructor?.name === 'ArchNodeVM' && i.Id === id)
        return { ok: true, id, label: shown?.Label, canUndo: doc.History.CanUndo, canRedo: doc.History.CanRedo }
    }, { op, probe })
}

// Every .todl under the arch project, concatenated — for a disk-truth assertion.
function todlText(archDir: string): string {
    const out: string[] = []
    const walk = (dir: string): void => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name)
            if (ent.isDirectory()) walk(p)
            else if (ent.name.endsWith('.todl')) out.push(fs.readFileSync(p, 'utf8'))
        }
    }
    walk(archDir)
    return out.join('\n')
}

// Poll the arch project's .todl until the probe's on-disk presence matches
// `present` (model.save() is fire-and-forget after commit / reconcile).
async function waitForDisk(l: Launched, archDir: string, present: boolean): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
        if (todlText(archDir).includes(PROBE) === present) return true
        await l.win.waitForTimeout(200)
    }
    return todlText(archDir).includes(PROBE) === present
}

test.describe.serial('arch rename undo/redo (live)', () => {
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
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open the project explorer, wheel the virtualized tree until
        // diagram-2.diagram (arch nodes) renders, then open it.
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
        for (let attempt = 0; attempt < 3 && (await archNodes(l)).length === 0; attempt++) {
            const dd = l.win.getByText('diagram-2.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('rename commits to disk; undo reverts model + label; redo replays', async () => {
        const before = await archNodes(l)
        await shot(l, 'undo-00-canvas')
        expect(before.length, 'expected arch nodes on diagram-2').toBeGreaterThan(0)
        expect(todlText(archDir).includes(PROBE), 'probe absent before rename').toBe(false)

        // ── Rename (commit) → written to the model's .todl ───────────────────
        const renamed = await onDoc(l, 'rename', PROBE)
        expect(renamed.ok, JSON.stringify(renamed)).toBe(true)
        expect(renamed.label).toBe(PROBE)
        expect(renamed.canUndo).toBe(true)
        expect(await waitForDisk(l, archDir, true), 'probe written to a .todl after commit').toBe(true)
        await shot(l, 'undo-01-renamed')

        // ── Undo → reverts the live label AND the .todl, one step ────────────
        const undone = await onDoc(l, 'undo', PROBE)
        expect(undone.ok, JSON.stringify(undone)).toBe(true)
        expect(undone.label, 'live label reverted to the original').toBe(renamed.before)
        expect(undone.canRedo).toBe(true)
        expect(await waitForDisk(l, archDir, false), 'probe removed from disk after undo').toBe(true)
        await shot(l, 'undo-02-undone')

        // ── Redo → replays the rename on both layers ─────────────────────────
        const redone = await onDoc(l, 'redo', PROBE)
        expect(redone.ok, JSON.stringify(redone)).toBe(true)
        expect(redone.label, 'live label re-applied by redo').toBe(PROBE)
        expect(await waitForDisk(l, archDir, true), 'probe re-written to disk after redo').toBe(true)
        await shot(l, 'undo-03-redone')

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
