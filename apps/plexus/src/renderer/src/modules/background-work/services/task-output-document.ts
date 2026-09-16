import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { TaskHandle } from './task-handle.js'

// A read-only document tab showing one task's live output log. Opened via
// host.Open() when the user clicks the task's row; the DataTemplate[TaskOutputDocument]
// (in background-work.resources.mu) binds $Handle.Output / $Handle.Status. Id is
// derived from the task id so re-opening re-activates the existing tab rather than
// stacking duplicates (DocumentsContentHostService dedupes by Id).
export class TaskOutputDocument implements IDocument {
    public readonly Handle: TaskHandle
    public readonly Id: string
    public readonly Title: string
    public readonly IsDirty = false

    constructor(handle: TaskHandle)
    {
        this.Handle = handle
        this.Id = `task-output:${handle.Id}`
        this.Title = `${handle.Title} — output`
    }

    public Save(): void { /* read-only: nothing to save */ }
}
