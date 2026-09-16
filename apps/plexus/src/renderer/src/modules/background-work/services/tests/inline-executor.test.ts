import { describe, it, expect } from 'vitest'
import { InlineExecutor } from '../inline-executor.js'
import { TaskKind, type ITaskContext } from '../task-executor.js'

const ctx: ITaskContext = {
    report: () => {}, log: () => {},
    signal: new AbortController().signal, throwIfCancelled: () => {},
}

describe('InlineExecutor', () => {
    it('is the Inline kind with unbounded capacity', () => {
        const e = new InlineExecutor()
        expect(e.kind).toBe(TaskKind.Inline)
        expect(e.capacity).toBe(Infinity)
    })
    it('runs the job function with the context and returns its result', async () => {
        let seen: ITaskContext | undefined
        const result = await new InlineExecutor().run(async (c) => { seen = c; return 7 }, ctx)
        expect(result).toBe(7)
        expect(seen).toBe(ctx)
    })
})
