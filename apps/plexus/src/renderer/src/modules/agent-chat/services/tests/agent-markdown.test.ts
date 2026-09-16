import { test, expect } from 'vitest'
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import { AgentMarkdownRenderer } from '../agent-markdown.js'

// Let the async image resolution (ReadBytes → decode → set Source) settle.
function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)) }

const PNG = new Uint8Array([1, 2, 3, 4])

test('a relative image path resolves against the conversation cwd and is read once, even across re-renders', async () => {
    const reads: string[] = []
    const reader = (p: string): Promise<Uint8Array> => { reads.push(p); return Promise.resolve(PNG) }
    const decode = (): Promise<Size | undefined> => Promise.resolve(new Size(10, 10))
    const md = new AgentMarkdownRenderer(reader, decode)

    // Windows-style absolute cwd; a relative src joins to it (POSIX-normalised).
    const cwd = 'c:\\proj\\demo'
    md.render('see ![shot](out/x.png)', cwd)
    md.render('see ![shot](out/x.png) and more text', cwd)   // streaming re-render
    await flush()

    expect(reads).toEqual(['c:/proj/demo/out/x.png'])   // resolved absolute path, read ONCE (cached)
})

test('a remote/data URI is passed straight through — no file read', async () => {
    const reads: string[] = []
    const reader = (p: string): Promise<Uint8Array> => { reads.push(p); return Promise.resolve(PNG) }
    const decode = (): Promise<Size | undefined> => Promise.resolve(new Size(8, 8))
    const md = new AgentMarkdownRenderer(reader, decode)

    md.render('![remote](https://example.com/a.png)', 'c:/proj')
    md.render('![data](data:image/png;base64,AAAA)', 'c:/proj')
    await flush()

    expect(reads).toEqual([])
})

test('render always returns a FlowDocument (image resolution never blocks the build)', () => {
    const md = new AgentMarkdownRenderer(() => Promise.reject(new Error('nope')))
    const doc = md.render('# Title\n\n![x](missing.png)', 'c:/proj')
    expect(doc).toBeDefined()
    expect(Array.from(doc.Blocks).length).toBeGreaterThan(0)   // heading + image paragraph
})
