import { test } from 'vitest'
import assert from 'node:assert/strict'
import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange, IWatchableStorage } from '@pragmatic-tech-ai/todl-runtime'
import { RemoteChangeCoordinator } from '../remote-change-coordinator.js'
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
    public async Reload(): Promise<void> { this.reloads++; this.Content = 'server'; this.IsDirty = false }
    public async Save(): Promise<void> { this.IsDirty = false }
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
