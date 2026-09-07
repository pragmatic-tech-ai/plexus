import { test, expect } from 'vitest'
import { SvgDocument } from '../svg-document.js'
import { SvgViewKind } from '../svg-view-kind.js'
import type { ICodeFile } from '../../code-editor/code-file.js'

// An in-memory ICodeFile so the document is tested without a real storage.
class FakeFile implements ICodeFile
{
    public constructor(public id: string, private text: string) {}
    public async read(): Promise<string> { return this.text }
    public async write(text: string): Promise<void> { this.text = text }
    public Retarget(id: string): void { this.id = id }
}

// Let the constructor's async load() settle.
async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve() }

test('loads content from the file and starts clean, visual-first', async () => {
    const doc = new SvgDocument(new FakeFile('a.svg', '<svg/>'))
    await settle()
    expect(doc.Content).toBe('<svg/>')
    expect(doc.IsDirty).toBe(false)
    expect(doc.ActiveView).toBe(SvgViewKind.Visual)
    expect(doc.IsVisualActive).toBe(true)
    expect(doc.IsTextActive).toBe(false)
    expect(doc.Language).toBe('xml')
})

test('editing content dirties; saving cleans and persists', async () => {
    const file = new FakeFile('a.svg', '<svg/>')
    const doc = new SvgDocument(file)
    await settle()
    doc.Content = '<svg id="x"/>'
    expect(doc.IsDirty).toBe(true)
    await doc.Save()
    expect(doc.IsDirty).toBe(false)
    expect(await file.read()).toBe('<svg id="x"/>')
})

test('ShowText / ShowVisual flip the active view and its booleans', async () => {
    const doc = new SvgDocument(new FakeFile('a.svg', '<svg/>'))
    await settle()
    doc.ShowText()
    expect(doc.ActiveView).toBe(SvgViewKind.Text)
    expect(doc.IsTextActive).toBe(true)
    expect(doc.IsVisualActive).toBe(false)
    doc.ShowVisual()
    expect(doc.IsVisualActive).toBe(true)
})

test('Title is the file name; Id is the path', async () => {
    const doc = new SvgDocument(new FakeFile('dir/logo.svg', '<svg/>'))
    await settle()
    expect(doc.Title).toBe('logo.svg')
    expect(doc.Id).toBe('dir/logo.svg')
})

test('exposes a Format Shape sink, no selection by default', async () => {
    const doc = new SvgDocument(new FakeFile('a.svg', '<svg/>'))
    await settle()
    expect(doc.SelectionStyle).toBeDefined()
    expect(doc.HasSelection).toBe(false)
})
