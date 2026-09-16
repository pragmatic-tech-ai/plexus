// Live smoke for the rendered Markdown viewer:
//  - The MarkdownViewerModule registers MarkdownDocumentFactory for .md, so the
//    ProjectExplorerService resolves it by extension.
//  - Opening a .md builds a MarkdownDocument (marked → FlowDocument: headings,
//    highlighted code, lists, tables, links, a local image), and the content host
//    applies DataTemplate[MarkdownDocument] → a RichTextBlock that lays it out.
// Unit tests cover the renderer/factory headless; this proves the live extension
// routing + template render in the real Electron app (incl. an image decode).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, cloneCorpus, appErrors, countByCtor, type Launched } from './plexus-app'

// A 1×1 PNG so the local-image path decodes for real in the renderer.
const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
)

const FIXTURE_MD = [
    '# Markdown Viewer',
    '',
    'A paragraph with **bold**, _italic_, `code`, ~~strike~~ and a [link](https://example.test/x).',
    '',
    '## Code',
    '',
    '```js',
    'const answer = 40 + 2',
    'console.log(answer)',
    '```',
    '',
    '## List',
    '',
    '- one',
    '- [ ] todo',
    '- [x] done',
    '',
    '## Table',
    '',
    '| L | R |',
    '|:--|--:|',
    '| a | b |',
    '',
    '> a blockquote',
    '',
    '![logo](./logo.png)',
    '',
    'Inline <b>raw html</b> too.',
    '',
].join('\n')

// Open readme.md through the real service chain and report the resulting state.
function openMarkdown(l: Launched, relPath: string) {
    return l.win.evaluate(async ({ relPath }) => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any, explorer: any
        for (let p = root?.Services; p && (!host || !explorer); p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) {
                const n = (e as any)?.constructor?.name
                if (n === 'DocumentsContentHostService') host = e
                if (n === 'ProjectExplorerService') explorer = e
            }
        }
        if (!host || !explorer) return { ok: false as const, reason: `host=${!!host} explorer=${!!explorer}` }

        // Extension routing: the explorer resolves .md to our factory (lazily
        // instantiating the service), which we then open the file with.
        const factory = explorer['resolveDocumentFactory']?.('.md')
        const routed = factory
        if (!factory) return { ok: false as const, reason: '.md did not resolve to a factory' }

        // Open the file from whichever project actually holds it.
        let opened: any
        const diag: string[] = []
        for (const op of explorer.OpenProjects.ToArray()) {
            const storage = op['storage']
            try {
                const doc = await factory.openFile(storage, relPath)
                host.Open(doc)
                opened = doc
                break
            } catch (e) {
                diag.push(`${op?.Name}: storage=${!!storage} err=${(e as Error)?.message}`)
            }
        }
        if (!opened) return { ok: false as const, reason: `no open project held the fixture — ${diag.join(' | ')}` }

        const active = host.ActiveDocument
        return {
            ok: true as const,
            routedIsMarkdown: routed?.constructor?.name === 'MarkdownDocumentFactory',
            activeName: active?.constructor?.name as string,
            blockCount: (active?.Document?.Blocks?.Count ?? 0) as number,
        }
    }, { relPath })
}

test.describe.serial('markdown viewer (live)', () => {
    let l: Launched
    let restoreSession: () => void
    let clone: { root: string; projects: string[]; archDir: string }

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        clone = cloneCorpus()
        // Drop the fixture (+ its local image) into every project so whichever one
        // is open by eval time holds it — arch projects can restore later than the
        // library/meta projects.
        for (const proj of clone.projects) {
            fs.writeFileSync(path.join(proj, 'readme.md'), FIXTURE_MD)
            fs.writeFileSync(path.join(proj, 'logo.png'), PNG_1x1)
        }
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (clone?.root) fs.rmSync(clone.root, { recursive: true, force: true })
    })

    test('opens a .md rendered as a RichTextBlock over a FlowDocument', async () => {
        const r = await openMarkdown(l, 'readme.md')
        expect(r.ok, `openMarkdown failed: ${(r as { reason?: string }).reason}`).toBe(true)
        if (!r.ok) return
        expect(r.routedIsMarkdown, '.md routes to MarkdownDocumentFactory').toBe(true)
        expect(r.activeName, 'active document is a MarkdownDocument').toBe('MarkdownDocument')
        expect(r.blockCount, 'FlowDocument has rendered blocks').toBeGreaterThan(0)

        // Give the template + async image decode a beat, then assert the view rendered.
        await l.win.waitForTimeout(1200)
        expect(await countByCtor(l.win, 'RichTextBlock'), 'RichTextBlock rendered').toBeGreaterThan(0)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
