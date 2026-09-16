import { describe, it, expect } from 'vitest'
import { TaskHandle, TaskStatus } from '../task-handle.js'

const make = () => new TaskHandle({ id: 't1', title: 'Job', kind: 'inline' })

describe('TaskHandle', () => {
    it('starts Queued and indeterminate', () => {
        const h = make()
        expect(h.Status).toBe(TaskStatus.Queued)
        expect(h.IsQueued).toBe(true)
        expect(h.IsIndeterminate).toBe(true)
        expect(h.IsDone).toBe(false)
    })

    it('report() sets determinate progress + note', () => {
        const h = make()
        h.report(0.4, 'step 2')
        expect(h.IsIndeterminate).toBe(false)
        expect(h.Progress).toBeCloseTo(0.4)
        expect(h.Note).toBe('step 2')
    })

    it('report() clamps to 0..1', () => {
        const h = make(); h.report(1.5)
        expect(h.Progress).toBe(1)
    })

    it('log() accumulates output lines', () => {
        const h = make(); h.log('a'); h.log('b')
        expect(h.Output).toBe('a\nb\n')
    })

    it('succeed() resolves Done with the result and marks Succeeded', async () => {
        const h = make(); h.markRunning(); h.succeed(42)
        expect(h.Status).toBe(TaskStatus.Succeeded)
        expect(h.IsDone).toBe(true)
        expect(h.IsRunning).toBe(false)
        await expect(h.Done).resolves.toBe(42)
    })

    it('fail() rejects Done and records the error', async () => {
        const h = make(); h.markRunning(); h.fail(new Error('boom'))
        expect(h.Status).toBe(TaskStatus.Failed)
        expect(h.Error).toBe('boom')
        await expect(h.Done).rejects.toThrow('boom')
    })

    it('cancel() on a queued task goes straight to Cancelled and aborts the signal', async () => {
        const h = make()
        expect(h.Signal.aborted).toBe(false)
        h.cancel()
        expect(h.Status).toBe(TaskStatus.Cancelled)
        expect(h.Signal.aborted).toBe(true)
        await expect(h.Done).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('cancel() on a running task enters Cancelling and aborts; finishCancelled() completes it', async () => {
        const h = make(); h.markRunning(); h.cancel()
        expect(h.Status).toBe(TaskStatus.Cancelling)
        expect(h.Signal.aborted).toBe(true)
        h.finishCancelled()
        expect(h.Status).toBe(TaskStatus.Cancelled)
        await expect(h.Done).rejects.toMatchObject({ name: 'AbortError' })
    })
})
