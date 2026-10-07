import type { WebContents } from 'electron'
import type { IBuildProgress, ProjectId, ActionStatus, ProjectBuildStatus, BuildDiagnostic } from '@pragmatic-tech-ai/todl/build-system-core'
import { BuildChannel, BuildProgressKind, type BuildProgressEvent } from '@pragmatic-tech-ai/plexus-core/shared/build-api.js'

/** Streams the engine's build progress to the renderer over IPC, tagged by runId. */
export class IpcBuildProgress implements IBuildProgress
{
    public constructor(private readonly runId: string, private readonly sender: WebContents)
    {
    }

    public SolutionStarted(order: readonly ProjectId[]): void
    {
        this.Emit(BuildProgressKind.SolutionStarted, [order])
    }

    public ProjectStarted(id: ProjectId, actions: readonly string[]): void
    {
        this.Emit(BuildProgressKind.ProjectStarted, [id, actions])
    }

    public ActionStarted(project: ProjectId, action: string): void
    {
        this.Emit(BuildProgressKind.ActionStarted, [project, action])
    }

    public ActionFinished(project: ProjectId, action: string, status: ActionStatus): void
    {
        this.Emit(BuildProgressKind.ActionFinished, [project, action, status])
    }

    public ProjectFinished(id: ProjectId, status: ProjectBuildStatus): void
    {
        this.Emit(BuildProgressKind.ProjectFinished, [id, status])
    }

    public Diagnostic(project: ProjectId, diagnostic: BuildDiagnostic): void
    {
        this.Emit(BuildProgressKind.Diagnostic, [project, diagnostic])
    }

    private Emit(kind: BuildProgressKind, args: unknown[]): void
    {
        const event: BuildProgressEvent = { runId: this.runId, kind, args }
        if (!this.sender.isDestroyed()) this.sender.send(BuildChannel.Progress, event)
    }
}
