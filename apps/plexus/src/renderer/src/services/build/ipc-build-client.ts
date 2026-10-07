import { BuildClientKey, BuildProgressDispatcher, type IBuildClient } from '@pragmatic-tech-ai/plexus-core/renderer/modules/build'
import type { BuildApplicable, BuildRunRequest, BuildRunResult, IBuildServerApi } from '@pragmatic-tech-ai/plexus-core/shared/build-api.js'
import type { IBuildProgress } from '@pragmatic-tech-ai/todl/build-system-core'
import type { IDisposable } from '@pragmatic-tech-ai/mural/runtime'

// The renderer-side build client: the concrete IBuildClient plexus-core's build UX resolves
// (through BuildClientKey). A thin wrapper over the preload bridge (window.api.build) — the same
// pattern as IpcPreviewServer — so builds execute in Electron main while plexus-core stays
// host-agnostic. It subscribes to the bridge's progress stream ONCE and fans events out to the
// reporter registered for each runId.
export class IpcBuildClient implements IBuildClient
{
    public static readonly Key = BuildClientKey

    private static readonly BridgeMissingMessage =
        'IpcBuildClient: window.api.build is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IBuildServerApi
    private readonly reporters = new Map<string, IBuildProgress>()

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { build?: IBuildServerApi } }).api
        if (bridge?.build === undefined)
        {
            throw new Error(IpcBuildClient.BridgeMissingMessage)
        }
        this.api = bridge.build
        this.api.OnProgress((e) =>
        {
            const progress = this.reporters.get(e.runId)
            if (progress !== undefined) BuildProgressDispatcher.Replay(progress, e)
        })
    }

    public Build(req: BuildRunRequest): Promise<BuildRunResult>
    {
        return this.api.Run(req)
    }

    public Applicable(manifestJson: string): Promise<readonly BuildApplicable[]>
    {
        return this.api.Applicable(manifestJson)
    }

    public OnProgress(runId: string, progress: IBuildProgress): IDisposable
    {
        this.reporters.set(runId, progress)
        return { dispose: () => { this.reporters.delete(runId) } }
    }
}

export default IpcBuildClient
