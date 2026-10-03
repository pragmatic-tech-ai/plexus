import { TaskKind, type ITaskContext, type ITaskExecutor, type InlineJob } from '../modules/background-work/index.js'

// The background-work executor for TaskKind.Publish: the payload IS the async publish job
// (it receives the task context so it can report progress through the same seam as any
// other task). Capacity 1 serializes publishes — two concurrent publishes of the same
// project would race the workspace registry, so they queue instead. A real executor class
// (the relocated background-work module ships only the built-in InlineExecutor); a consumer
// registers one of these before submitting a Publish task.
export class PublishTaskExecutor implements ITaskExecutor<InlineJob<unknown>, unknown>
{
    public readonly kind = TaskKind.Publish
    public readonly capacity = 1

    public run(payload: InlineJob<unknown>, ctx: ITaskContext): Promise<unknown>
    {
        return payload(ctx)
    }
}
