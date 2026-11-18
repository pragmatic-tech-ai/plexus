import { test } from 'vitest'
import assert from 'node:assert/strict'
import { ContentHostService, DocumentTypeRegistry } from '@pragmatic-tech-ai/mural/framework'
import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import { DocOwnership } from '../doc-ownership.js'
import { RemoteFileStorage } from '../../../storage/remote-file-storage.js'
import type { IDevStorageSession } from '../../../storage/remote-file-storage.js'
import { IncomingApplyResult } from '../../../storage/remote-change-coordinator.js'

class FakeDoc
{
    public readonly Id = 'a'
    public readonly Title = 'a'
    public IsDirty = true
    public applied = 0
    public async ApplyIncoming(): Promise<IncomingApplyResult> { this.applied++; return IncomingApplyResult.DirtySkipped }
    public Save(): void {}
}

test('rename re-tracks the open remote doc on the new path (old path ignored)', async () =>
{
    const handlers = new Set<(c: { Path: string; Kind: 'changed'; IsDirectory: boolean }) => void>()
    const session = { OnStorageChanged: (h: never) => { handlers.add(h); return () => handlers.delete(h) } } as unknown as IDevStorageSession
    const storage = new RemoteFileStorage(session, 'root')
    const member = { Storage: storage } as unknown as SolutionMember
    const doc = new FakeDoc()
    const factory = { openFile: async () => doc, relocateOpenFile: () => {}, relocatable: true }
    const host = { Open: () => {}, OpenPreview: () => {} }
    const registry = { GetByExtension: () => undefined }
    const provider = {
        getRequired: (k: unknown) => (k === ContentHostService.Key ? host : { IsWindows: false }),
        get: (k: unknown) => (k === DocumentTypeRegistry.Key ? registry : undefined),
    }
    const docs = new DocOwnership(provider as never)
    await docs.OpenDocument(member, 'src/old.todl', factory as never)
    const emit = (p: string): void => { for (const h of [...handlers]) h({ Path: p, Kind: 'changed', IsDirectory: false }) }
    emit('src/old.todl'); await new Promise(r => setTimeout(r, 0))
    assert.equal(doc.applied, 1)
    ;(docs as unknown as { FactoryFor(): unknown }).FactoryFor = () => ({ relocateOpenFile: () => {}, relocatable: true })
    docs.RepointOpenDocuments(member, 'src/old.todl', 'src/new.todl')
    emit('src/old.todl'); await new Promise(r => setTimeout(r, 0))
    assert.equal(doc.applied, 1)
    emit('src/new.todl'); await new Promise(r => setTimeout(r, 0))
    assert.equal(doc.applied, 2)
    assert.equal(docs.RemoteChanges.IsChangedOnServer('src/new.todl'), true)
    assert.equal(docs.RemoteChanges.IsChangedOnServer('src/old.todl'), false)
})
