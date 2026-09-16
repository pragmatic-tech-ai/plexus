// task-executor.ts
// The pluggable background-work seam: a task is a `kind` + `title` + `payload`;
// an executor registered for that kind actually runs it, talking back only
// through ITaskContext (so a Web Worker executor can relay the same calls over
// postMessage). See docs/superpowers/specs/2026-08-30-background-work-service-design.md.

export enum TaskKind {
    Inline  = 'inline',   // payload IS an async fn — convenience for one-off jobs
    Publish = 'publish',
    Layout  = 'layout',
}

export interface BackgroundTask<P = unknown> {
    kind:    TaskKind | string
    title:   string
    payload: P
    // Optional custom "open" target for the task's status-bar row. When present the
    // manager wires OpenOutputCommand to it instead of opening the default output
    // document (e.g. an agent-run task opens its conversation).
    open?:   () => void
}

// The executor's only channel back to the task while it runs.
export interface ITaskContext {
    report(fraction: number, note?: string): void   // 0..1; omit to stay indeterminate
    log(line: string): void                         // -> the task's output panel
    readonly signal: AbortSignal                    // cancellation
    throwIfCancelled(): void
}

// One execution strategy, registered by kind.
export interface ITaskExecutor<P = unknown, R = unknown> {
    readonly kind:     TaskKind | string
    readonly capacity: number                       // max concurrent of this kind (Infinity ok)
    run(payload: P, ctx: ITaskContext): Promise<R>
}

// Kind -> executor. Last registration wins (lets an app override a default).
export class TaskExecutorRegistry {
    private readonly byKind = new Map<string, ITaskExecutor>()
    public register(executor: ITaskExecutor): void { this.byKind.set(String(executor.kind), executor) }
    public get(kind: TaskKind | string): ITaskExecutor | undefined { return this.byKind.get(String(kind)) }
}
