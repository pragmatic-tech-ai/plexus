import type { IpcMain } from 'electron'
import type { ProjectBuildOutput } from '@pragmatic-tech-ai/todl/build-system-core'
import { BuildChannel, type BuildRunRequest, type BuildRunResult } from '@pragmatic-tech-ai/plexus-core/shared/build-api.js'
import type { MainBuildProvider } from './main-build-provider.js'
import { IpcBuildProgress } from './ipc-build-progress.js'

/** Wires the build IPC handlers in the Electron main process. */
export class BuildIpc
{
    public static Register(ipc: IpcMain, provider: MainBuildProvider): void
    {
        ipc.handle(BuildChannel.Run, (e, req: BuildRunRequest) =>
            provider.Build(req, new IpcBuildProgress(req.runId, e.sender)).then(BuildIpc.ToResult))
        ipc.handle(BuildChannel.Applicable, (_e, manifestJson: string) => provider.Applicable(manifestJson))
    }

    private static ToResult(out: ProjectBuildOutput): BuildRunResult
    {
        return { Ok: out.Result.Ok, OutputPath: out.Result.OutputPath, Diagnostics: out.Result.Diagnostics }
    }
}
