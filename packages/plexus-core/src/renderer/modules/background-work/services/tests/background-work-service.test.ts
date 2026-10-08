import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { BackgroundWorkService } from '../background-work-service.js'
import { TaskStatus } from '../task-handle.js'
import { TaskKind, type ITaskContext, type ITaskExecutor } from '../task-executor.js'
import { ViewportKey, type IViewport } from '../../../../viewport/viewport.js'

function svc(): BackgroundWorkService { return new BackgroundWorkService(new ServiceProvider()) }

// An executor whose run() is resolved manually so tests control timing.
function gatedExecutor(kind: string, capacity: number)
{
    const gates: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; ctx: ITaskContext }> = []
    const executor: ITaskExecutor = {
        kind, capacity,
        run: (_p, ctx) => new Promise((resolve, reject) => { gates.push({ resolve, reject, ctx }) }),
    }
    return { executor, gates }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('BackgroundWorkService', () => {
    it('summarises an empty queue', () => {
        expect(svc().SummaryText).toBe('No background tasks')
    })

    it('sizes the popup to the window via the viewport seam', () => {
        const provider = new ServiceProvider()
        const viewport: IViewport = { Width: 1400, Height: 900, Subscribe: () => () => {} }
        provider.registerInstance(ViewportKey, viewport)
        const s = new BackgroundWorkService(provider)
        expect(s.PopupWidth).toBe(1400)
        expect(s.ListMaxHeight).toBe(270)   // 30% of 900
    })

    it('falls back to fixed popup sizes when no viewport is available', () => {
        const s = svc()
        expect(s.PopupWidth).toBe(420)
        expect(s.ListMaxHeight).toBe(320)
    })

    it('submit with an open override wires OpenOutputCommand to it', () => {
        const s = svc()
        let opened = 0
        const { handle } = s.submit({ kind: TaskKind.Inline, title: 'run', payload: async () => 'ok', open: () => { opened++ } })
        handle.OpenOutputCommand!.Execute(undefined)
        expect(opened).toBe(1)
    })

    it('runs up to capacity and queues the rest', async () => {
        const s = svc()
        const { executor } = gatedExecutor('k', 2)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        s.submit({ kind: 'k', title: 'B', payload: null })
        s.submit({ kind: 'k', title: 'C', payload: null })
        await tick()
        expect(s.RunningCount).toBe(2)
        expect(s.QueuedCount).toBe(1)
        expect(s.SummaryText).toBe('2 running, 1 queued')
    })

    it('admits a queued task when a running one completes', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        s.submit({ kind: 'k', title: 'B', payload: null })
        await tick()
        expect(s.RunningCount).toBe(1)
        gates[0].resolve(undefined)
        await tick(); await tick()
        expect(s.RunningCount).toBe(1)      // B now running
        expect(s.QueuedCount).toBe(0)
    })

    it('resolves the submit done-promise with the executor result', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        const { done } = s.submit<null, number>({ kind: 'k', title: 'A', payload: null })
        await tick()
        gates[0].resolve(99)
        await expect(done).resolves.toBe(99)
    })

    it('marks Failed and rejects done on executor error', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        const { handle, done } = s.submit({ kind: 'k', title: 'A', payload: null })
        await tick()
        gates[0].reject(new Error('nope'))
        await expect(done).rejects.toThrow('nope')
        expect(handle.Status).toBe(TaskStatus.Failed)
    })

    it('cancelling a queued task never runs it', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        const { handle: b } = s.submit({ kind: 'k', title: 'B', payload: null })
        await tick()
        b.cancel()
        gates[0].resolve(undefined)
        await tick(); await tick()
        expect(b.Status).toBe(TaskStatus.Cancelled)
        expect(gates.length).toBe(1)        // B never entered run()
    })

    it('finishes a running task as Cancelled when its executor rejects with AbortError after cancel', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 1)
        s.Register(executor)
        const { handle } = s.submit({ kind: 'k', title: 'A', payload: null })
        await tick()
        handle.cancel()                     // aborts ctx.signal
        expect(gates[0].ctx.signal.aborted).toBe(true)
        gates[0].reject(new DOMException('x', 'AbortError'))
        await tick()
        expect(handle.Status).toBe(TaskStatus.Cancelled)
    })

    it('run() executes an inline job and resolves its result', async () => {
        const s = svc()
        const { done } = s.run('inline', async () => 5)
        await expect(done).resolves.toBe(5)
    })

    it('ClearCompleted removes only finished tasks', async () => {
        const s = svc()
        const { executor, gates } = gatedExecutor('k', 2)
        s.Register(executor)
        s.submit({ kind: 'k', title: 'A', payload: null })
        s.submit({ kind: 'k', title: 'B', payload: null })
        await tick()
        gates[0].resolve(undefined)
        await tick()
        s.ClearCompletedCommand.Execute(undefined)
        expect(s.Tasks.Count).toBe(1)       // only the still-running B remains
    })

    it('sets OpenOutputCommand which opens a task-output document on the content host', async () => {
        const provider = new ServiceProvider()
        const opened: Array<{ Id: string }> = []
        // Register a fake DocumentsContentHostService under ContentHostService.Key.
        const { ContentHostService } = await import('@pragmatic-tech-ai/mural/framework')
        provider.register(ContentHostService.Key, () => ({ Open: (d: { Id: string }) => opened.push(d) }) as never)
        const s = new BackgroundWorkService(provider)
        const { handle } = s.run('inline', async () => 1)
        handle.OpenOutputCommand?.Execute(undefined)
        expect(opened.length).toBe(1)
        expect(opened[0].Id).toBe(`task-output:${handle.Id}`)
        // Re-open returns the SAME document instance (dedupe by identity + Id).
        handle.OpenOutputCommand?.Execute(undefined)
        expect(opened[1]).toBe(opened[0])
    })
})
