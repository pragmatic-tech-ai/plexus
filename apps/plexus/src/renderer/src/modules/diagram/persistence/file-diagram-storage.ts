import type { DiagramStorage } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Backs a single `.diagram` file through mural's DiagramStorage seam, so a
// DiagramDocument's native Save() / Load() persist the full scene (nodes,
// connectors, shape text) as JSON — no bespoke serializer needed.
//
// It writes through an IStorage at a project-relative Path, so the diagram's
// backend (local FS today, cloud/REST later) is transparent to the document.
//
// DiagramStorage is a synchronous key/value contract, but storage I/O is async,
// so this mirrors the settings-store pattern: reads are served from an
// in-memory snapshot (seeded from storage when the document is opened), and
// SetItem caches synchronously while firing the write in the background. Await
// WhenWritten() after Save() to be sure the bytes are persisted.
//
// A file holds exactly one diagram, so the storage KEY is ignored — there is a
// single slot. (mural writes/reads under one fixed internal key.)
export class FileDiagramStorage implements DiagramStorage
{
    private snapshot: string | null
    private pending: Promise<void> = Promise.resolve()

    // Path is mutable so an in-place rename can re-point the open document at
    // its new project-relative location without reloading the scene (subsequent
    // Save() writes go to the new path).
    constructor(
        public Path: string,
        private readonly storage: IStorage,
        seed: string | null,
    )
    {
        this.snapshot = seed
    }

    // The project IStorage this diagram is persisted through — used by the
    // architecture-projects binding to match a diagram to its owning project.
    public get ProjectStorage(): IStorage
    {
        return this.storage
    }

    public GetItem(_key: string): string | null
    {
        return this.snapshot
    }

    public SetItem(_key: string, value: string): void
    {
        this.snapshot = value
        this.pending = this.storage.WriteText(this.Path, value)
    }

    // Resolves when the most recent SetItem's disk write has completed.
    public WhenWritten(): Promise<void>
    {
        return this.pending
    }
}
