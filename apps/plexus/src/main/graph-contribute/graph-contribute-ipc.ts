import type { IpcMain } from 'electron'
import { RelayWire } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { GraphContributeChannel, type ContributedPackage } from '../../shared/graph-contribute-api.js'
import type { GraphContributeService } from './graph-contribute-service.js'

// Binds the graph-contribute IPC channels. Every handler answers a RelayReply envelope so the failure
// sentence (and an account kind) reaches the renderer intact. Renderer arguments are checked before
// they reach the service.
export class GraphContributeIpc
{
    private static readonly BadArguments = 'The contribute request was malformed.'

    public static Register(ipc: IpcMain, service: Pick<GraphContributeService, 'Contribute' | 'ListGraphs'>): void
    {
        ipc.handle(GraphContributeChannel.Contribute, (_e, environment: unknown, graphName: unknown, solutionId: unknown, packages: unknown) => RelayWire.Capture(async () =>
            service.Contribute(GraphContributeIpc.Name(environment), GraphContributeIpc.Name(graphName), GraphContributeIpc.Name(solutionId), GraphContributeIpc.Packages(packages))))
        ipc.handle(GraphContributeChannel.ListGraphs, (_e, environment: unknown) => RelayWire.Capture(async () =>
            service.ListGraphs(GraphContributeIpc.Name(environment))))
    }

    private static Name(value: unknown): string
    {
        if (typeof value !== 'string' || value.trim() === '') throw new TypeError(GraphContributeIpc.BadArguments)
        return value
    }

    private static Packages(value: unknown): ContributedPackage[]
    {
        if (!Array.isArray(value)) throw new TypeError(GraphContributeIpc.BadArguments)
        return value as ContributedPackage[]
    }
}
