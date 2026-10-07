/**
 * The connections view seam — the read/mutate/refresh surface the Connections tree branch,
 * the per-project active-connection row, and the connection editor dialog consume. It sits
 * above `IConnectionsClient` (the IPC layer) and adds resolution-status decoration
 * (`ConnectionHealth`), the effective per-project active connection, and the change signal.
 * Mirrors P5a's `IReferenceView`. Implemented by `ConnectionEditingService`.
 */
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import type { ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager/connections'
import type { ConnectionInspection, ConnectionTestResult } from './connections-client.js'

// The decorated health of a connection, from its view fields + the last on-demand Test.
export enum ConnectionHealth
{
    Default,        // the default connection (marked ★)
    Ready,          // has credentials (stored or env), or a prior Test succeeded
    NoCredentials,  // no stored token and no env source
    Unreachable,    // the last on-demand Test failed
}

// Which hierarchy scope a connection is defined at. Global connections are the app-wide inventory
// (the secret/registry authority); Solution/Project connections are property bags overlaid by the
// active solution or one of its projects. Mirrors todl's BagScope, kept local so the view seam does
// not depend on todl's enum.
export enum ConnectionScope
{
    Global,
    Solution,
    Project,
}

// The decorated per-connection row the tree renders (never carries a token).
export interface ConnectionLeafView
{
    readonly Id: string
    readonly DisplayName: string
    readonly RegistryType: string
    readonly Scope: ConnectionScope        // which scope the connection is defined at
    readonly IsDefault: boolean            // the GLOBAL default (the connection inventory's default)
    readonly IsSolutionDefault: boolean    // the active solution's default (solution-scope IsDefault)
    readonly HasToken: boolean
    readonly Health: ConnectionHealth
    readonly Message?: string   // the Test error, when Unreachable
}

export interface IConnectionView
{
    ConnectionsView(): Promise<readonly ConnectionLeafView[]>
    EnvVars(): Promise<readonly string[]>                                       // dialog: env-token picker
    AddConnection(spec: ConnectionSpec, secret?: string): Promise<void>
    UpdateConnection(id: string, partial: Partial<ConnectionSpec>): Promise<void>
    SetToken(id: string, token: string): Promise<void>
    UseEnvToken(id: string, varName: string): Promise<void>
    SetDefault(id: string): Promise<void>                  // the GLOBAL default
    SetSolutionDefault(id: string): Promise<void>          // the active solution's default (solution.json)
    RemoveConnection(id: string): Promise<void>
    TestConnection(id: string): Promise<ConnectionTestResult>
    InspectConnection(id: string): Promise<ConnectionInspection>   // full token inspection; also feeds the health decoration
    IsConsumer(member: SolutionMember): boolean                                 // sync gate for the active-connection row
    ActiveConnectionFor(member: SolutionMember): Promise<ConnectionLeafView | undefined>   // effective
    SetActiveConnectionFor(member: SolutionMember, connectionId: string | undefined): Promise<void>
    OnConnectionsViewChanged(handler: (affected: SolutionMember | undefined) => void): IDisposable
}

export const ConnectionViewKey = new ServiceKey<IConnectionView>('IConnectionView')
