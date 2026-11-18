import type { TargetRef } from '../../../../shared/account-api.js'
import { type Solution, type IManager } from '@pragmatic-tech-ai/todl'
import type { SolutionOriginRegistry } from './solution-origin-registry.js'

// Where an opened solution came from. Today every solution is opened from the
// local file system (the only open path); when an open-from-dev-environment path
// is added it will carry a DevEnvironment origin and the UI already renders it.
export enum SolutionOriginKind
{
    FileSystem = 'file-system',
    DevEnvironment = 'dev-environment',
}

export interface FileSystemOrigin
{
    readonly Kind: SolutionOriginKind.FileSystem
}

export interface DevEnvironmentOrigin
{
    readonly Kind: SolutionOriginKind.DevEnvironment
    readonly EnvironmentName: string
    // The console source + env name needed to reconstruct the dev session.
    readonly EnvironmentRef: TargetRef
    readonly SolutionName: string
}

export type SolutionOrigin = FileSystemOrigin | DevEnvironmentOrigin

// The one home for solution-origin reasoning: the origin of a solution and its
// human-readable label, shared by the Solution Explorer header and the window title.
export class SolutionOrigins
{
    public static readonly FileSystem: FileSystemOrigin = { Kind: SolutionOriginKind.FileSystem }

    private static readonly FileSystemLabel = 'File system'
    private static readonly DevEnvironmentLabelPrefix = 'Dev environment: '

    // The origin of a solution: a DevEnvironment origin when the registry knows it as opened from a
    // dev environment, else the local file system.
    public static Of(solution: Solution, registry?: SolutionOriginRegistry): SolutionOrigin
    {
        return registry?.Get(solution) ?? SolutionOrigins.FileSystem
    }

    public static DevEnvironment(ref: TargetRef, solutionName: string): DevEnvironmentOrigin
    {
        return {
            Kind: SolutionOriginKind.DevEnvironment,
            EnvironmentName: ref.Name,
            EnvironmentRef: ref,
            SolutionName: solutionName,
        }
    }

    public static Label(origin: SolutionOrigin): string
    {
        switch (origin.Kind)
        {
            case SolutionOriginKind.FileSystem:
                return SolutionOrigins.FileSystemLabel
            case SolutionOriginKind.DevEnvironment:
                return SolutionOrigins.DevEnvironmentLabelPrefix + origin.EnvironmentName
        }
    }

    // The origin label for whatever solution is active, or undefined when none is open.
    public static ActiveLabel(manager: IManager | undefined, registry?: SolutionOriginRegistry): string | undefined
    {
        const solution = manager?.ActiveSolution
        return solution === undefined ? undefined : SolutionOrigins.Label(SolutionOrigins.Of(solution, registry))
    }
}
