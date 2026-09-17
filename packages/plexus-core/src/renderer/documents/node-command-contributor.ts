import { ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../projects/open-project.js'
import type { ProjectNode } from '../projects/project.js'

// A single project-type-specific context-menu action for a tree node: a label
// and the command it runs.
export interface NodeAction
{
    readonly label: string
    readonly command: ICommand
}

// Optional contributor of a node context-menu action, consulted by the
// ProjectExplorer as it wires each node. Keeps the generic explorer decoupled
// from module-specific node commands (e.g. the architecture "Edit Viewpoints…"
// on a .diagram node). A no-op when unregistered; returns undefined for nodes it
// doesn't act on.
export interface INodeCommandContributor
{
    contribute(op: OpenProject, node: ProjectNode): NodeAction | undefined
}

export const NodeCommandContributorKey = new ServiceKey<INodeCommandContributor>('NodeCommandContributor')
