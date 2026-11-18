import type { TargetRef } from '../../../../shared/account-api.js'
import { type Solution, type SolutionManagerService } from '@pragmatic-tech-ai/todl'

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

    // The origin of a solution. Every solution reachable today was opened from the
    // local file system — the Solution carries no origin and the only open entry
    // point (OpenProjectAt) takes a local folder. When an open-from-dev-environment
    // path exists, it is the sole place that will produce a DevEnvironment origin.
    public static Of(_solution: Solution): SolutionOrigin
    {
        return SolutionOrigins.FileSystem
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
    public static ActiveLabel(manager: SolutionManagerService | undefined): string | undefined
    {
        const solution = manager?.ActiveSolution
        return solution === undefined ? undefined : SolutionOrigins.Label(SolutionOrigins.Of(solution))
    }
}
