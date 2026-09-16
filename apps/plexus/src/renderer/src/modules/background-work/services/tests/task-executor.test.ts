import { describe, it, expect } from 'vitest'
import { TaskExecutorRegistry, TaskKind, type ITaskExecutor } from '../task-executor.js'

function stub(kind: string): ITaskExecutor {
    return { kind, capacity: 1, run: async () => undefined }
}

describe('TaskExecutorRegistry', () => {
    it('returns undefined for an unregistered kind', () => {
        expect(new TaskExecutorRegistry().get(TaskKind.Publish)).toBeUndefined()
    })
    it('registers and resolves an executor by kind', () => {
        const r = new TaskExecutorRegistry()
        const e = stub(TaskKind.Publish)
        r.register(e)
        expect(r.get(TaskKind.Publish)).toBe(e)
    })
    it('later registration for the same kind overrides the earlier one', () => {
        const r = new TaskExecutorRegistry()
        const first = stub(TaskKind.Layout), second = stub(TaskKind.Layout)
        r.register(first); r.register(second)
        expect(r.get(TaskKind.Layout)).toBe(second)
    })
})
