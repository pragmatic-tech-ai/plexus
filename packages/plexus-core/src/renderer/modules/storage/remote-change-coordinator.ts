import { Observable, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange, IWatchableStorage } from '@pragmatic-tech-ai/todl-runtime'
import { IncomingChangeGuard } from './incoming-change-guard.js'
import { IncomingApplyResult } from './incoming-apply-result.js'

// The slice of an open buffer this coordinator needs: its dirty flag, a reload
// from storage, and the save it wraps so a local save clears the flag.
// ApplyIncoming MUST read storage, then re-check dirtiness synchronously right before
// applying (so keystrokes typed during the async read are never overwritten).
export interface ITrackedDocument
{
    readonly IsDirty: boolean
    ApplyIncoming(): Promise<IncomingApplyResult>
    Save(): void | Promise<void>
    // Optional non-destructive "changed on server" marker the document may surface.
    SetChangedOnServer?(flag: boolean): void
}

// Handles incoming remote (dev-environment) storage changes for OPEN buffers with
// save-level last-writer-wins: a clean buffer reloads; a dirty buffer is never
// clobbered, it is flagged "changed on server" (observable, non-destructive) and
// the local save later overwrites. Engaged only for remote storage by its owner —
// local-FS behavior is untouched.
export class RemoteChangeCoordinator extends Observable
{
    private static readonly SaveMember = 'Save'
    public static readonly ChangedOnServerPathsProp = 'ChangedOnServerPaths'

    private readonly guard = new IncomingChangeGuard()
    private readonly docs = new Map<string, ITrackedDocument>()

    // Watch `path` (one directory level up) on `storage` and route changes to `doc`.
    // Wraps doc.Save so a local save calls NoteSaved. Dispose to stop and unwrap.
    public Track(storage: IWatchableStorage, path: string, doc: ITrackedDocument): IDisposable
    {
        const originalSave = doc.Save
        const hadOwnSave = Object.prototype.hasOwnProperty.call(doc, RemoteChangeCoordinator.SaveMember)
        doc.Save = async (): Promise<void> =>
        {
            await originalSave.call(doc)
            this.NoteSaved(path)
        }
        this.docs.set(path, doc)
        const stop = storage.Watch(RemoteChangeCoordinator.DirectoryOf(path), change => void this.OnChange(path, doc, change))
        return {
            dispose: (): void =>
            {
                stop()
                if (hadOwnSave) doc.Save = originalSave
                else delete (doc as Partial<ITrackedDocument>).Save
                this.NoteSaved(path)
                this.docs.delete(path)
            },
        }
    }

    public async OnChange(path: string, doc: ITrackedDocument, change: FileChange): Promise<void>
    {
        if (change.IsDirectory || change.Kind === FileChangeKind.Removed) return
        if (RemoteChangeCoordinator.Normalize(change.Path) !== RemoteChangeCoordinator.Normalize(path)) return
        const result = await doc.ApplyIncoming()
        if (result === IncomingApplyResult.Unchanged) return
        const before = this.guard.IsChangedOnServer(path)
        this.guard.Decide(path, result === IncomingApplyResult.DirtySkipped)
        this.Sync(path, before)
    }

    // Carry a flagged state to a renamed path: flag `path` (as a dirty skip would) and mark its doc.
    public MarkChangedOnServer(path: string): void
    {
        const before = this.guard.IsChangedOnServer(path)
        this.guard.Decide(path, true)
        this.Sync(path, before)
    }

    public IsChangedOnServer(path: string): boolean
    {
        return this.guard.IsChangedOnServer(path)
    }

    // Save-level LWW: the local save overwrites the server copy.
    public NoteSaved(path: string): void
    {
        const before = this.guard.IsChangedOnServer(path)
        this.guard.NoteSaved(path)
        this.Sync(path, before)
    }

    // Push the flag to the document marker and raise only when the flagged set changed.
    private Sync(path: string, before: boolean): void
    {
        const now = this.guard.IsChangedOnServer(path)
        if (now === before) return
        this.docs.get(path)?.SetChangedOnServer?.(now)
        this.RaiseChanged()
    }

    private RaiseChanged(): void
    {
        this.RaisePropertyChanged(RemoteChangeCoordinator.ChangedOnServerPathsProp, undefined, undefined)
    }

    private static DirectoryOf(path: string): string
    {
        const n = RemoteChangeCoordinator.Normalize(path)
        const slash = n.lastIndexOf('/')
        return slash === -1 ? '' : n.slice(0, slash)
    }

    private static Normalize(path: string): string
    {
        return path.split(/[\/]/).filter(s => s.length > 0).join('/')
    }
}
