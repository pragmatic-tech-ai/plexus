import { TaskKind, type ITaskContext, type ITaskExecutor } from './task-executor.js'

// The reference executor: the payload IS the async job, so `run` just invokes it
// with the context. Backs BackgroundWorkService.run(title, fn) for one-off inline
// work. Unbounded capacity — inline async jobs don't contend for a worker slot.
export type InlineJob<R = unknown> = (ctx: ITaskContext) => Promise<R>

export class InlineExecutor implements ITaskExecutor<InlineJob<unknown>, unknown> {
    public readonly kind = TaskKind.Inline
    public readonly capacity = Infinity
    public run(payload: InlineJob<unknown>, ctx: ITaskContext): Promise<unknown> { return payload(ctx) }
}
