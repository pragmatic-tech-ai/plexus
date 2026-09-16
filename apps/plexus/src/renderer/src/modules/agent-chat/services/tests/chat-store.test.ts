import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ChatStore, type StoredConversation } from '../chat-store.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { TranscriptRole } from '../transcript.js'

function fakeFs() {
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
    }
}

function providerWith(fs: unknown): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, fs as FileSystemService)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as EnvironmentService)
    return provider
}

const rec: StoredConversation = { Id: 's1', Title: 'Chat 1', ResumeToken: 'cli-1', Cwd: '/proj', UpdatedAt: 1234, Transcript: [{ Role: TranscriptRole.User, Text: 'hi' }] }

test('upsert then list round-trips a record', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    expect(await store.List()).toEqual([rec])
})

test('upsert replaces a record with the same id', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    await store.Upsert({ ...rec, Title: 'Renamed' })
    const list = await store.List()
    expect(list).toHaveLength(1)
    expect(list[0].Title).toBe('Renamed')
})

test('remove drops a record', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert(rec)
    await store.Remove('s1')
    expect(await store.List()).toEqual([])
})

test('upsert round-trips the UpdatedAt timestamp', async () => {
    const store = new ChatStore(providerWith(fakeFs()))
    await store.Upsert({ ...rec, UpdatedAt: 99_999 })
    expect((await store.List())[0].UpdatedAt).toBe(99_999)
})

test('a record persisted before UpdatedAt existed back-fills to 0 on read', async () => {
    const fs = fakeFs()
    // A legacy file whose record has no UpdatedAt field.
    await fs.WriteText('/data/conversations.json', JSON.stringify([{ Id: 's1', Title: 'Old', ResumeToken: 't', Transcript: [] }]))
    const store = new ChatStore(providerWith(fs))
    expect((await store.List())[0].UpdatedAt).toBe(0)
})
