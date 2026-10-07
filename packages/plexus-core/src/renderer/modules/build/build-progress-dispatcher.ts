import type { IBuildProgress, ActionStatus, ProjectBuildStatus, BuildDiagnostic, ProjectId } from '@pragmatic-tech-ai/todl/build-system-core'
import { BuildProgressKind, type BuildProgressEvent } from '../../../shared/build-api.js'

// Replays a wire-level BuildProgressEvent onto the matching IBuildProgress method.
export class BuildProgressDispatcher
{
    public static Replay(progress: IBuildProgress, event: BuildProgressEvent): void
    {
        const a = event.args
        switch (event.kind)
        {
            case BuildProgressKind.SolutionStarted:
                progress.SolutionStarted(a[0] as readonly ProjectId[])
                break
            case BuildProgressKind.ProjectStarted:
                progress.ProjectStarted(a[0] as ProjectId, a[1] as readonly string[])
                break
            case BuildProgressKind.ActionStarted:
                progress.ActionStarted(a[0] as ProjectId, a[1] as string)
                break
            case BuildProgressKind.ActionFinished:
                progress.ActionFinished(a[0] as ProjectId, a[1] as string, a[2] as ActionStatus)
                break
            case BuildProgressKind.ProjectFinished:
                progress.ProjectFinished(a[0] as ProjectId, a[1] as ProjectBuildStatus)
                break
            case BuildProgressKind.Diagnostic:
                progress.Diagnostic(a[0] as ProjectId, a[1] as BuildDiagnostic)
                break
        }
    }
}
