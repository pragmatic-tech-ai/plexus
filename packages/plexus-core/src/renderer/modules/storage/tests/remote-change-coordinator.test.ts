import { test } from 'vitest'
import assert from 'node:assert/strict'
import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange, IWatchableStorage } from '@pragmatic-tech-ai/todl-runtime'
import { IncomingApplyResult, RemoteChangeCoordinator } from '../remote-change-coordinator.js'
import type { ITrackedDocument } from '../remote-change-coordinator.js'

class FakeStorage implements IWatchableStorage
{
    public sinks: Array<(c: FileChange) => void> = []
    public watched: string[] = []

    public Watch(path: string, sink: (c: FileChange) => void): () => void
    {
        this.watched.push(path)
        this.sinks.push(sink)
        return (): void => { this.sinks = this.sinks.filter(s => s !== sink) }
    }

    public Emit(path: string): void
    {
        for (const s of [...this.sinks]) s({ Kind: FileChangeKind.Changed, Path: path, IsDirectory: false })
    }
}

class FakeDoc implements ITrackedDocument
{
    public IsDirty = false
    public Content = 'local'
    public reloads = 0
    public marker = false
    public serverText = 'server'
    public savedText = 'local'
    public beforeApply: (() => void) | undefined
    public async ApplyIncoming(): Promise<IncomingApplyResult>
    {
        await Promise.resolve()
        this.beforeApply?.()
        if (this.serverText === this.savedText) return IncomingApplyResult.Unchanged
        if (this.IsDirty) return IncomingApplyResult.DirtySkipped
        this.reloads++; this.Content = this.serverText; this.savedText = this.serverText
        return IncomingApplyResult.Applied
    }
    public async Save(): Promise<void> { this.IsDirty = false; this.savedText = this.Content }
    public SetChangedOnServer(flag: boolean): void { this.marker = flag }
}

const Settle = (): Promise<void> => new Promise(r => setTimeout(r, 0))

test('clean buffer: incoming change reloads and is not flagged', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    c.Track(storage, 'src/a.todl', doc)
    assert.deepEqual(storage.watched, ['src'])
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(doc.reloads, 1)
    assert.equal(c.IsChangedOnServer('src/a.todl'), false)
})

test('dirty buffer: not clobbered, flagged, reactive', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    const raised: string[] = []
    c.PropertyChanged(RemoteChangeCoordinator.ChangedOnServerPathsProp).subscribe(e => raised.push(e.property))
    c.Track(storage, 'src/a.todl', doc)
    doc.IsDirty = true
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(doc.reloads, 0)
    assert.equal(doc.Content, 'local')
    assert.equal(c.IsChangedOnServer('src/a.todl'), true)
    assert.ok(raised.includes(RemoteChangeCoordinator.ChangedOnServerPathsProp))
})

test('local save clears the flag (LWW)', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    c.Track(storage, 'src/a.todl', doc)
    doc.IsDirty = true
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(c.IsChangedOnServer('src/a.todl'), true)
    await doc.Save()
    assert.equal(c.IsChangedOnServer('src/a.todl'), false)
})

test('other paths ignored; dispose stops watching and unwraps save', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    const originalSave = doc.Save
    const handle = c.Track(storage, 'src/a.todl', doc)
    storage.Emit('src/b.todl'); await Settle()
    assert.equal(doc.reloads, 0)
    handle.dispose()
    assert.equal(storage.sinks.length, 0)
    assert.equal(doc.Save, originalSave)
})

test('buffer goes dirty DURING the reload: not overwritten, flagged', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    c.Track(storage, 'src/a.todl', doc)
    doc.beforeApply = (): void => { doc.IsDirty = true; doc.Content = 'typed' }
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(doc.Content, 'typed')
    assert.equal(c.IsChangedOnServer('src/a.todl'), true)
    assert.equal(doc.marker, true)
})

test('own-write echo: no reload, no false flag, no raise', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    let raised = 0
    c.PropertyChanged(RemoteChangeCoordinator.ChangedOnServerPathsProp).subscribe(() => raised++)
    c.Track(storage, 'src/a.todl', doc)
    doc.Content = 'mine'; doc.IsDirty = true
    await doc.Save()
    doc.serverText = 'mine'
    doc.IsDirty = true; doc.Content = 'mine-plus-typing'
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(doc.reloads, 0)
    assert.equal(c.IsChangedOnServer('src/a.todl'), false)
    assert.equal(raised, 0)
})

test('raises only when the flagged set actually changes', async () =>
{
    const storage = new FakeStorage(), doc = new FakeDoc(), c = new RemoteChangeCoordinator()
    let raised = 0
    c.PropertyChanged(RemoteChangeCoordinator.ChangedOnServerPathsProp).subscribe(() => raised++)
    c.Track(storage, 'src/a.todl', doc)
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(raised, 0)
    doc.IsDirty = true; doc.serverText = 'x1'
    storage.Emit('src/a.todl'); await Settle()
    storage.Emit('src/a.todl'); await Settle()
    assert.equal(raised, 1)
})

test('save awaits the real write before clearing the flag', async () =>
{
    const storage = new FakeStorage(), c = new RemoteChangeCoordinator()
    let finish: () => void = () => {}
    const doc = new FakeDoc()
    doc.Save = (): Promise<void> => new Promise(r => { finish = r })
    c.Track(storage, 'src/a.todl', doc)
    doc.IsDirty = true
    storage.Emit('src/a.todl'); await Settle()
    const saving = doc.Save()
    await Settle()
    assert.equal(c.IsChangedOnServer('src/a.todl'), true)
    finish(); await saving
    assert.equal(c.IsChangedOnServer('src/a.todl'), false)
})
