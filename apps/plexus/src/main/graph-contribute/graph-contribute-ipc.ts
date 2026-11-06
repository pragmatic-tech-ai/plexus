import type { IpcMain } from 'electron'
import { RelayWire, TargetIdentity, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { GraphContributeChannel, type ContributedPackage } from '../../shared/graph-contribute-api.js'
import type { GraphContributeService } from './graph-contribute-service.js'

// Binds the graph-contribute IPC channels. Every handler answers a RelayReply envelope so the failure
// sentence (and an account kind) reaches the renderer intact. Renderer arguments are checked before
// they reach the service: the target must be { Name, Source } with a known source, and only those
// two fields are handed on.
export class GraphContributeIpc
{
    private static readonly BadArguments = 'The contribute request was malformed.'

    public static Register(ipc: IpcMain, service: Pick<GraphContributeService, 'Contribute' | 'ListGraphs'>): void
    {
        ipc.handle(GraphContributeChannel.Contribute, (_e, target: unknown, graphName: unknown, solutionId: unknown, packages: unknown) => RelayWire.Capture(async () =>
            service.Contribute(GraphContributeIpc.Target(target), GraphContributeIpc.Name(graphName), GraphContributeIpc.Name(solutionId), GraphContributeIpc.Packages(packages))))
        ipc.handle(GraphContributeChannel.ListGraphs, (_e, target: unknown) => RelayWire.Capture(async () =>
            service.ListGraphs(GraphContributeIpc.Target(target))))
    }

    private static Target(value: unknown): TargetRef
    {
        const target = TargetIdentity.RefFrom(value)
        if (target === undefined) throw new TypeError(GraphContributeIpc.BadArguments)
        return target
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
