import { test, expect } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

test('FakeStorage round-trips WriteBytes → ReadBytes', async () => {
    const s = new FakeStorage()
    await s.WriteBytes('a.bin', new Uint8Array([1, 2, 3, 250]))
    expect([...await s.ReadBytes('a.bin')]).toEqual([1, 2, 3, 250])
})

test('FakeStorage ReadBytes reads WriteText content as ASCII bytes', async () => {
    const s = new FakeStorage()
    await s.WriteText('a.txt', 'hi')
    expect([...await s.ReadBytes('a.txt')]).toEqual([104, 105])
})
