import { ServiceKey, type ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from './open-project.js'
import type { ProjectNode } from './project.js'

// The tree behaviors (selection, drag/drop, template) run against whatever the
// TreeView's DataContext is; in the explorer that DataContext is the project
// host. This narrow interface is the only surface those behaviors touch, so the
// substrate stays decoupled from the concrete ProjectExplorerService (which
// lives app-side until Phase E and implements this).
export interface IProjectTreeHost
{
    readonly OpenProjects: ObservableCollection<OpenProject>
    OwnerOf(node: ProjectNode): OpenProject | undefined
    ApplyTreeSelection(items: readonly unknown[], primary: unknown): void
    AddRevealListener(listener: (folder: ProjectNode) => void): () => void
}

// The payload OpenProject.MoveNodesCommand carries — a node move within or across
// projects. `source` is the project the dragged nodes came from.
export interface MoveArg { nodes: readonly ProjectNode[]; destPath: string; source: OpenProject }

// The DI token the host registers itself under (app-side alias in Phase D).
export const ProjectTreeHostKey = new ServiceKey<IProjectTreeHost>('IProjectTreeHost')

// Duck-typed narrowing of a Visual's DataContext to the host — mirrors the
// explorer's other structural guards (isRevealable) so a behavior never depends
// on the concrete service class for an `instanceof` check.
export function isProjectTreeHost(x: unknown): x is IProjectTreeHost
{
    const h = x as Partial<IProjectTreeHost>
    return typeof h?.OwnerOf === 'function'
        && typeof h?.ApplyTreeSelection === 'function'
        && typeof h?.AddRevealListener === 'function'
}
