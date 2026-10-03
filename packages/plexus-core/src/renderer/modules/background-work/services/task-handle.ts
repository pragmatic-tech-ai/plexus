import { MuralBase, MetaData, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// Lifecycle of one background task.
export enum TaskStatus
{
    Queued     = 'queued',
    Running    = 'running',
    Succeeded  = 'succeeded',
    Failed     = 'failed',
    Cancelling = 'cancelling',
    Cancelled  = 'cancelled',
}

function abortError(): DOMException { return new DOMException('Task cancelled', 'AbortError') }

// The live view-model for one background task — one row in the status-bar list
// and the backing model for its output document. A MuralBase so the .mu
// templates bind $Title / $Progress / $Status / $Output etc. The manager drives
// it via markRunning / succeed / fail / finishCancelled; the row UI drives it via
// CancelCommand / OpenOutputCommand.
export class TaskHandle extends MuralBase
{
    public static readonly TitleKey           = MuralBase.RegisterProperty<string>(TaskHandle, 'Title', '', MetaData.None)
    public static readonly StatusKey          = MuralBase.RegisterProperty<TaskStatus>(TaskHandle, 'Status', TaskStatus.Queued, MetaData.None)
    public static readonly ProgressKey        = MuralBase.RegisterProperty<number>(TaskHandle, 'Progress', 0, MetaData.None)
    public static readonly IsIndeterminateKey = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsIndeterminate', true, MetaData.None)
    public static readonly NoteKey            = MuralBase.RegisterProperty<string>(TaskHandle, 'Note', '', MetaData.None)
    public static readonly OutputKey          = MuralBase.RegisterProperty<string>(TaskHandle, 'Output', '', MetaData.None)
    public static readonly ErrorKey           = MuralBase.RegisterProperty<string>(TaskHandle, 'Error', '', MetaData.None)
    public static readonly IsRunningKey       = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsRunning', false, MetaData.None)
    public static readonly IsQueuedKey        = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsQueued', true, MetaData.None)
    public static readonly IsDoneKey          = MuralBase.RegisterProperty<boolean>(TaskHandle, 'IsDone', false, MetaData.None)
    public static readonly CancelCommandKey     = MuralBase.RegisterProperty<ICommand | undefined>(TaskHandle, 'CancelCommand', undefined, MetaData.None)
    public static readonly OpenOutputCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(TaskHandle, 'OpenOutputCommand', undefined, MetaData.None)
    // Optional Re-run affordance (Skills #4): a skill run sets this so the dock shows
    // a Re-run button that re-opens the input form prefilled with the run's inputs.
    public static readonly RerunCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(TaskHandle, 'RerunCommand', undefined, MetaData.None)
    public static readonly HasRerunKey = MuralBase.RegisterProperty<boolean>(TaskHandle, 'HasRerun', false, MetaData.None)

    public readonly Id: string
    public readonly Kind: string
    public readonly Done: Promise<unknown>
    private readonly controller = new AbortController()
    private _resolve!: (v: unknown) => void
    private _reject!:  (e: unknown) => void

    constructor(init: { id: string; title: string; kind: string })
    {
        super()
        this.Id = init.id
        this.Kind = init.kind
        this.set_property_value(TaskHandle.TitleKey, init.title)
        this.Done = new Promise<unknown>((res, rej) => { this._resolve = res; this._reject = rej })
        // Mark internally-handled so an ignored rejection (e.g. a fire-and-forget
        // cancel) never warns; callers get the same promise and may attach their own.
        this.Done.catch(() => {})
        this.set_property_value(TaskHandle.CancelCommandKey, new RelayCommand(() => this.cancel(), () => !this.IsDone))
    }

    public get Title(): string { return this.get_property_value(TaskHandle.TitleKey) }
    public get Status(): TaskStatus { return this.get_property_value(TaskHandle.StatusKey) }
    public get Progress(): number { return this.get_property_value(TaskHandle.ProgressKey) }
    public get IsIndeterminate(): boolean { return this.get_property_value(TaskHandle.IsIndeterminateKey) }
    public get Note(): string { return this.get_property_value(TaskHandle.NoteKey) }
    public get Output(): string { return this.get_property_value(TaskHandle.OutputKey) }
    public get Error(): string { return this.get_property_value(TaskHandle.ErrorKey) }
    public get IsRunning(): boolean { return this.get_property_value(TaskHandle.IsRunningKey) }
    public get IsQueued(): boolean { return this.get_property_value(TaskHandle.IsQueuedKey) }
    public get IsDone(): boolean { return this.get_property_value(TaskHandle.IsDoneKey) }
    public get OpenOutputCommand(): ICommand | undefined { return this.get_property_value(TaskHandle.OpenOutputCommandKey) }
    public set OpenOutputCommand(v: ICommand | undefined) { this.set_property_value(TaskHandle.OpenOutputCommandKey, v) }
    public get RerunCommand(): ICommand | undefined { return this.get_property_value(TaskHandle.RerunCommandKey) }
    public set RerunCommand(v: ICommand | undefined) { this.set_property_value(TaskHandle.RerunCommandKey, v); this.set_property_value(TaskHandle.HasRerunKey, v !== undefined) }
    public get HasRerun(): boolean { return this.get_property_value(TaskHandle.HasRerunKey) }
    public get Signal(): AbortSignal { return this.controller.signal }

    public report(fraction: number, note?: string): void
    {
        this.set_property_value(TaskHandle.IsIndeterminateKey, false)
        this.set_property_value(TaskHandle.ProgressKey, Math.max(0, Math.min(1, fraction)))
        if (note !== undefined) this.set_property_value(TaskHandle.NoteKey, note)
    }

    public log(line: string): void
    {
        this.set_property_value(TaskHandle.OutputKey, this.Output + line + '\n')
    }

    public throwIfCancelled(): void { if (this.controller.signal.aborted) throw abortError() }

    public markRunning(): void { this.setStatus(TaskStatus.Running) }

    public succeed(result: unknown): void
    {
        if (!this.IsIndeterminate) this.set_property_value(TaskHandle.ProgressKey, 1)
        this.setStatus(TaskStatus.Succeeded)
        this._resolve(result)
    }

    public fail(error: unknown): void
    {
        this.set_property_value(TaskHandle.ErrorKey, error instanceof Error ? error.message : String(error))
        this.setStatus(TaskStatus.Failed)
        this._reject(error)
    }

    // User-initiated cancel. A queued task never ran, so it completes immediately;
    // a running task is asked to stop (Cancelling) and the executor is expected to
    // observe the signal, after which the manager calls finishCancelled().
    public cancel(): void
    {
        if (this.IsDone) return
        this.controller.abort()
        if (this.Status === TaskStatus.Queued) { this.setStatus(TaskStatus.Cancelled); this._reject(abortError()) }
        else this.setStatus(TaskStatus.Cancelling)
    }

    public finishCancelled(): void
    {
        if (this.Status === TaskStatus.Cancelled) return
        this.setStatus(TaskStatus.Cancelled)
        this._reject(abortError())
    }

    private setStatus(status: TaskStatus): void
    {
        this.set_property_value(TaskHandle.StatusKey, status)
        this.set_property_value(TaskHandle.IsRunningKey, status === TaskStatus.Running)
        this.set_property_value(TaskHandle.IsQueuedKey, status === TaskStatus.Queued)
        const done = status === TaskStatus.Succeeded || status === TaskStatus.Failed || status === TaskStatus.Cancelled
        this.set_property_value(TaskHandle.IsDoneKey, done)
        const cancel = this.get_property_value(TaskHandle.CancelCommandKey) as RelayCommand | undefined
        cancel?.RaiseCanExecuteChanged?.()
    }
}
