import type { IpcMain } from 'electron'
import { GraphContributeChannel, type ContributedPackage } from '../../shared/graph-contribute-api.js'
import type { GraphContributeService } from './graph-contribute-service.js'
import type { GraphProfileStore } from './graph-profile-store.js'

// Binds the graph-contribute IPC channels. The token is write-only: SetProfile stores it,
// HasProfile reports only whether one is configured.
export class GraphContributeIpc
{
    public static Register(ipc: IpcMain, service: GraphContributeService, profiles: GraphProfileStore): void
    {
        ipc.handle(GraphContributeChannel.Contribute, (_e, graphName: string, solutionId: string, packages: ContributedPackage[]) => service.Contribute(graphName, solutionId, packages))
        ipc.handle(GraphContributeChannel.SetProfile, (_e, serverUrl: string, token: string) => profiles.Save(serverUrl, token))
        ipc.handle(GraphContributeChannel.HasProfile, async () => (await profiles.Load()) !== undefined)
    }
}
