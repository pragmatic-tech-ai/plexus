import {
    ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { TaskExecutorRegistry, TaskKind, type BackgroundTask, type ITaskContext, type ITaskExecutor } from './task-executor.js'
import { TaskHandle, TaskStatus } from './task-handle.js'
import { InlineExecutor, type InlineJob } from './inline-executor.js'
import { TaskOutputDocument } from './task-output-document.js'

export interface SubmitResult<R> { handle: TaskHandle; done: Promise<R> }

// Standalone key (like ProblemsServiceKey) — the status-bar ShellControl uses it
// as its DataContext (provider.get(token), no class->Key normalization).
export const BackgroundWorkServiceKey = new ServiceKey<BackgroundWorkService>('BackgroundWorkService')

// One queued item awaiting a free executor slot.
interface QueuedItem { handle: TaskHandle; payload: unknown }

// The background-work manager: accepts submissions, routes each to the executor
// registered for its kind, admits up to that executor's capacity at once, and
// owns the observable task list + status-bar summary. Root-registered so any
// service can resolve it and submit. Mirrors ProblemsService's shape.
export class BackgroundWorkService extends ServiceBase {
    public static readonly Key = BackgroundWorkServiceKey

    private readonly _tasks = new ObservableCollection<TaskHandle>()
    private _runningCount = 0
    private _queuedCount = 0
    private _summaryText = 'No background tasks'
    private _isOpen = false
    private readonly _clearCompletedCommand: ICommand

    private readonly registry = new TaskExecutorRegistry()
    private readonly queues = new Map<string, QueuedItem[]>()   // per-kind FIFO of waiting tasks
    private readonly running = new Map<string, number>()        // per-kind in-flight count
    private readonly outputDocs = new WeakMap<TaskHandle, TaskOutputDocument>()
    private seq = 0

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this._clearCompletedCommand = new RelayCommand(() => this.clearCompleted())
        this.registry.register(new InlineExecutor())
    }

    public get Tasks(): ObservableCollection<TaskHandle> { return this._tasks }
    public get RunningCount(): number { return this._runningCount }
    private setRunningCount(v: number): void { const o = this._runningCount; if (o === v) return; this._runningCount = v; this.RaisePropertyChanged('RunningCount', o, v) }
    public get QueuedCount(): number { return this._queuedCount }
    private setQueuedCount(v: number): void { const o = this._queuedCount; if (o === v) return; this._queuedCount = v; this.RaisePropertyChanged('QueuedCount', o, v) }
    public get SummaryText(): string { return this._summaryText }
    private setSummaryText(v: string): void { const o = this._summaryText; if (o === v) return; this._summaryText = v; this.RaisePropertyChanged('SummaryText', o, v) }
    public get IsOpen(): boolean { return this._isOpen }
    public set IsOpen(v: boolean) { const o = this._isOpen; if (o === v) return; this._isOpen = v; this.RaisePropertyChanged('IsOpen', o, v) }
    public get ClearCompletedCommand(): ICommand { return this._clearCompletedCommand }

    // Register an executor for its kind (last wins). Domains call this to add
    // Publish/Layout/Worker executors; the InlineExecutor is built in.
    public Register(executor: ITaskExecutor): void { this.registry.register(executor) }

    public submit<P, R>(task: BackgroundTask<P>): SubmitResult<R>
    {
        const handle = new TaskHandle({ id: `task-${++this.seq}`, title: task.title, kind: String(task.kind) })
        handle.OpenOutputCommand = task.open !== undefined
            ? new RelayCommand(task.open)
            : new RelayCommand(() => this.openOutput(handle))
        this.Tasks.Add(handle)
        const kind = String(task.kind)
        const q = this.queues.get(kind) ?? []
        q.push({ handle, payload: task.payload })
        this.queues.set(kind, q)
        this.updateCounts()
        this.pump(kind)
        return { handle, done: handle.Done as Promise<R> }
    }

    public run<R>(title: string, fn: InlineJob<R>): SubmitResult<R>
    {
        return this.submit<InlineJob<R>, R>({ kind: TaskKind.Inline, title, payload: fn })
    }

    // Admit as many queued tasks of `kind` as the executor's capacity allows.
    private pump(kind: string): void
    {
        const executor = this.registry.get(kind)
        const q = this.queues.get(kind)
        if (executor === undefined || q === undefined) return
        while (q.length > 0 && (this.running.get(kind) ?? 0) < executor.capacity) {
            const item = q.shift() as QueuedItem
            if (item.handle.IsDone) continue          // cancelled while queued — skip
            this.startOne(kind, executor, item)
        }
        this.updateCounts()
    }

    private startOne(kind: string, executor: ITaskExecutor, item: QueuedItem): void
    {
        const { handle } = item
        handle.markRunning()
        this.running.set(kind, (this.running.get(kind) ?? 0) + 1)
        this.updateCounts()
        const ctx: ITaskContext = {
            report: (f, n) => handle.report(f, n),
            log: (l) => handle.log(l),
            signal: handle.Signal,
            throwIfCancelled: () => handle.throwIfCancelled(),
        }
        executor.run(item.payload, ctx)
            .then((r) => handle.succeed(r))
            .catch((e) => { if (isAbort(e)) handle.finishCancelled(); else handle.fail(e) })
            .finally(() => {
                this.running.set(kind, (this.running.get(kind) ?? 1) - 1)
                this.pump(kind)
                this.updateCounts()
            })
    }

    // Open (or re-activate) the task's live output log as a document tab. The doc
    // is cached per handle so re-opening focuses the existing tab.
    private openOutput(handle: TaskHandle): void
    {
        let doc = this.outputDocs.get(handle)
        if (doc === undefined) { doc = new TaskOutputDocument(handle); this.outputDocs.set(handle, doc) }
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.Open(doc)
    }

    private clearCompleted(): void
    {
        const keep = [...this.Tasks].filter((t) => !t.IsDone)
        this.Tasks.Clear()
        for (const t of keep) this.Tasks.Add(t)
        this.updateCounts()
    }

    private updateCounts(): void
    {
        const all = [...this.Tasks]
        const running = all.filter((t) => t.Status === TaskStatus.Running).length
        const queued  = all.filter((t) => t.Status === TaskStatus.Queued).length
        this.setRunningCount(running)
        this.setQueuedCount(queued)
        this.setSummaryText(summarize(running, queued))
    }
}

function isAbort(e: unknown): boolean { return e instanceof Error && e.name === 'AbortError' }

function summarize(running: number, queued: number): string
{
    if (running === 0 && queued === 0) return 'No background tasks'
    const parts: string[] = []
    if (running > 0) parts.push(`${running} running`)
    if (queued > 0) parts.push(`${queued} queued`)
    return parts.join(', ')
}
