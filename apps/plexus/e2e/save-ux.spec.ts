// Integration coverage for the save-UX feature: the autosave settings register
// with their defaults, and a dirty document's tab-close raises the real
// Save / Don't Save / Cancel dialog (Cancel keeps the tab, Don't Save closes it).
//
// The per-branch LOGIC is unit-tested (save-prompt-model, document-close-guard,
// autosave-service, confirm-close-docs); this spec proves the wiring end-to-end in
// the running app: the Save module's settings reached ApplicationSettings, and the
// PlexusDocumentHost → DocumentCloseGuard → DialogService path is connected.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, appErrors, rectsForCtor, clickCenter, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'c:/Users/Eugene/Projects/architecture-agent/plexus_test_projects'
const PROJECT_RELS = [
    'meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture',
]
// Two component nodes on diagram-2 with no connector between them (drawing one
// flips the DiagramDocument's IsDirty flag — our "make it dirty" lever).
const A = 'knowledge_index'
const B = 'enterprise_legacy_app'

function makeCopy(): string {
    const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-save-ux-'))
    for (const rel of PROJECT_RELS) fs.cpSync(path.join(CORPUS, rel), path.join(copyRoot, rel), { recursive: true })
    return copyRoot
}

async function draw(l: Launched, fromId: string, toId: string): Promise<boolean> {
    const r = await l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram) return false
        const arr: any[] = diagram.ItemsSource.ToArray()
        const byId = (id: string) => arr.find((vm: any) => vm?.Id === id)
        const Ep = diagram.Connectors?.ToArray?.()[0]?.Source?.constructor
        if (!Ep) return false
        const src = byId(fromId), tgt = byId(toId)
        if (!src || !tgt) return false
        diagram._fireConnectorCreated({ Source: new Ep({ Node: src }), Target: new Ep({ Node: tgt }) })
        return true
    }, { fromId, toId })
    await l.win.waitForTimeout(1200)
    return r
}

async function hasNode(l: Launched, id: string): Promise<boolean> {
    return l.win.evaluate((id) => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram')
                return (v.ItemsSource?.ToArray?.() ?? []).some((vm: any) => vm?.Id === id)
        }
        return false
    }, id)
}

async function docIsDirty(l: Launched): Promise<boolean | undefined> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        const doc = diagram?.DataContext
        return typeof doc?.IsDirty === 'boolean' ? doc.IsDirty : undefined
    })
}

async function openCount(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && typeof dc.CloseById === 'function' && dc.OpenDocuments) return dc.OpenDocuments.ToArray().length
        }
        return -1
    })
}

// Invoke a button on the open SavePromptModel dialog by executing its command —
// exactly what the button binding (Command = $CancelCommand, …) does. Driving the
// command is more robust than a DOM click: mural renders an invisible
// <rect class="mural-hit"> hit layer that intercepts Playwright text-clicks.
async function clickPrompt(l: Launched, which: 'Save' | 'DontSave' | 'Cancel'): Promise<boolean> {
    return l.win.evaluate((which) => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && dc.constructor?.name === 'SavePromptModel') {
                const cmd = which === 'Save' ? dc.SaveCommand : which === 'DontSave' ? dc.DontSaveCommand : dc.CancelCommand
                cmd?.Execute(undefined)
                return true
            }
        }
        return false
    }, which)
}

// Whether a SavePromptModel dialog is currently in the visual tree.
async function promptShown(l: Launched): Promise<boolean> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            if ((el as any)[S]?.DataContext?.constructor?.name === 'SavePromptModel') return true
        }
        return false
    })
}

// Fire the host's CloseDocumentCommand for the ACTIVE document — the exact command
// the tab ✕ and Ctrl+W invoke (now routed through the close guard).
async function fireActiveClose(l: Launched): Promise<boolean> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let host: any
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && typeof dc.CloseById === 'function' && dc.OpenDocuments) { host = dc; break }
        }
        if (!host) return false
        const d = host.ActiveDocument
        if (!d) return false
        host.CloseDocumentCommand.Execute(d.Id)
        return true
    })
}

async function closeAllDocs(l: Launched): Promise<void> {
    await l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let host: any
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && typeof dc.CloseById === 'function' && dc.OpenDocuments) { host = dc; break }
        }
        if (host) for (const id of host.OpenDocuments.ToArray().map((d: any) => d.Id)) host.CloseById(id)
    })
    await l.win.waitForTimeout(1200)
}

async function openDiagramFileOnce(l: Launched, relPath: string): Promise<void> {
    await l.win.evaluate(async (relPath) => {
        const S = Symbol.for('mural:visual-backref')
        let explorer: any
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && typeof dc.OpenFileInProject === 'function') { explorer = dc; break }
        }
        if (!explorer) return
        const proj = explorer.OpenProjects.ToArray().find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
        if (proj) await explorer.OpenFileInProject(proj.Folder, relPath, 0, 0)
    }, relPath)
    await l.win.waitForTimeout(3500)
}

// Open diagram-2 and wait until a diagram-2-specific node is present, retrying the
// open (OpenFileInProject can no-op if the explorer service isn't reachable yet).
async function ensureDiagramOpen(l: Launched, relPath: string, probeId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await hasNode(l, probeId)) return true
        await openDiagramFileOnce(l, relPath)
    }
    return hasNode(l, probeId)
}

test.describe.serial('save-ux', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        copyRoot = makeCopy()
        restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1500)
        await closeAllDocs(l)
        await ensureDiagramOpen(l, 'diagram-2.diagram', A)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('autosave settings register with their defaults', async () => {
        const enabled = await l.win.evaluate(() => (globalThis as any).__getSetting?.('documents.autosave.enabled'))
        const minutes = await l.win.evaluate(() => (globalThis as any).__getSetting?.('documents.autosave.intervalMinutes'))
        expect(enabled, 'autosave enabled by default').toBe(true)
        expect(minutes, 'autosave interval defaults to 5 minutes').toBe(5)
    })

    test('closing a dirty tab prompts; Cancel keeps it, Don\'t Save closes it', async () => {
        expect(await ensureDiagramOpen(l, 'diagram-2.diagram', A), 'diagram-2 opened').toBe(true)
        expect(await openCount(l), 'exactly one doc open').toBe(1)

        // Make the document dirty.
        expect(await draw(l, A, B), 'connector drawn').toBe(true)
        expect(await docIsDirty(l), 'dirty after draw').toBe(true)

        // Fire the active-document close → the guard must raise the prompt.
        expect(await fireActiveClose(l), 'close command fired').toBe(true)
        await l.win.waitForTimeout(800)
        await expect(l.win.getByText(/has unsaved changes/i).first(), 'save prompt shown').toBeVisible()
        expect(await promptShown(l), 'SavePromptModel in tree').toBe(true)

        // Cancel keeps the tab open (and still dirty).
        expect(await clickPrompt(l, 'Cancel'), 'Cancel invoked').toBe(true)
        await l.win.waitForTimeout(800)
        expect(await promptShown(l), 'prompt dismissed after Cancel').toBe(false)
        expect(await openCount(l), 'tab still open after Cancel').toBe(1)
        expect(await docIsDirty(l), 'still dirty after Cancel').toBe(true)

        // Fire again → Don't Save closes the tab without saving.
        expect(await fireActiveClose(l), 'close command fired again').toBe(true)
        await l.win.waitForTimeout(800)
        expect(await promptShown(l), 'save prompt shown again').toBe(true)
        expect(await clickPrompt(l, 'DontSave'), "Don't Save invoked").toBe(true)
        await l.win.waitForTimeout(1000)
        expect(await openCount(l), 'tab closed after Don\'t Save').toBe(0)
    })

    test('no app errors', async () => {
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
