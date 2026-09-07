import { test, expect } from 'vitest'
import { SvgDocumentFactory } from '../svg-document-factory.js'
import type { IStorage, StorageEntry } from '../../../services/storage/storage.js'

// Minimal in-memory IStorage.
class MemStorage implements IStorage
{
    public readonly Root = 'mem'
    private files = new Map<string, string>()
    public async ReadText(p: string): Promise<string> { return this.files.get(p) ?? '' }
    public async ReadBytes(): Promise<Uint8Array> { return new Uint8Array() }
    public async WriteText(p: string, c: string): Promise<void> { this.files.set(p, c) }
    public async WriteBytes(): Promise<void> {}
    public async Exists(p: string): Promise<boolean> { return this.files.has(p) }
    public async Delete(p: string): Promise<void> { this.files.delete(p) }
    public async CreateDirectory(): Promise<void> {}
    public async Rename(): Promise<void> {}
    public async List(): Promise<readonly StorageEntry[]> { return [] }
    public has(p: string): boolean { return this.files.has(p) }
    public text(p: string): string | undefined { return this.files.get(p) }
}

test('newFile writes a minimal svg and returns the .svg path', async () => {
    const storage = new MemStorage()
    const factory = new SvgDocumentFactory()
    const path = await factory.newFile(storage, 'drawing')
    expect(path).toBe('drawing.svg')
    expect(storage.has('drawing.svg')).toBe(true)
    expect(storage.text('drawing.svg')).toContain('<svg')
})

test('newFile keeps an existing .svg extension', async () => {
    const factory = new SvgDocumentFactory()
    expect(await factory.newFile(new MemStorage(), 'logo.svg')).toBe('logo.svg')
})

test('openFile yields a document whose Id is the path', async () => {
    const storage = new MemStorage()
    await storage.WriteText('a.svg', '<svg/>')
    const doc = await new SvgDocumentFactory().openFile(storage, 'a.svg')
    expect(doc.Id).toBe('a.svg')
})
