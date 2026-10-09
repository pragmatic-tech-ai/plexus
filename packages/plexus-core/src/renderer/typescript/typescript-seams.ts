import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Upward-free seams declared in plexus-core so project lifecycle code here can
// drive TypeScript language services implemented in apps/plexus (a higher layer).

export interface ITypeScriptWorkspaceSink
{
    AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void>
    DetachProject(projectId: string): void
}

export interface ITypeScriptDiagnosticsSink
{
    TrackProject(projectId: string, projectName: string): void
    UntrackProject(projectId: string): void
}

export const TypeScriptWorkspaceSinkKey = new ServiceKey<ITypeScriptWorkspaceSink>('TypeScriptWorkspaceSink')
export const TypeScriptDiagnosticsSinkKey = new ServiceKey<ITypeScriptDiagnosticsSink>('TypeScriptDiagnosticsSink')
