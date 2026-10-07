import { ServiceKey, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import type { IBuildProgress } from '@pragmatic-tech-ai/todl/build-system-core'
import type { BuildRunRequest, BuildRunResult, BuildApplicable } from '../../../shared/build-api.js'

// Host-agnostic build capability: todl builds run in the host's main process; the renderer
// reaches them only through this interface + key. A desktop host (apps/plexus) supplies the
// concrete impl over its IPC bridge and registers it under BuildClientKey.
export interface IBuildClient
{
    Build(req: BuildRunRequest): Promise<BuildRunResult>
    Applicable(manifestJson: string): Promise<readonly BuildApplicable[]>
    OnProgress(runId: string, progress: IBuildProgress): IDisposable
}

export const BuildClientKey = new ServiceKey<IBuildClient>('BuildClient')
