import { RelayCommand, ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../../../services/projects/open-project.js'
import type { ProjectNode } from '../../../services/projects/project.js'
import type { INodeCommandContributor, NodeAction } from '../../../services/documents/node-command-contributor.js'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { DiagramViewpointsEditor } from './diagram-viewpoints-editor.js'

// Contributes the "Edit Viewpoints…" context-menu action to a .diagram node in
// an architecture project (the explorer surface of the viewpoints editor, paired
// with the diagram toolbar command). Opens/focuses the diagram, ensures its arch
// binding is attached, then runs the shared editor flow.
export class ArchNodeCommandContributor extends ServiceBase implements INodeCommandContributor
{
    public static readonly Key = new ServiceKey<ArchNodeCommandContributor>('ArchNodeCommandContributor')

    public constructor(provider: IServiceProvider) { super(provider) }

    public contribute(op: OpenProject, node: ProjectNode): NodeAction | undefined
    {
        if (op.Project.Type !== 'architecture') return undefined
        // A .diagram file node — note its Kind is 'diagram' (the arch factory tags
        // diagram files), so gate on the path/extension, not Kind === 'file'.
        if (node.Kind === 'folder' || !node.Path.toLowerCase().endsWith('.diagram')) return undefined
        return { label: 'Edit Viewpoints…', command: new RelayCommand(() => void this.edit(op, node.Path)) }
    }

    private async edit(op: OpenProject, path: string): Promise<void>
    {
        const doc = await this.Provider.getRequired(ProjectExplorerService.Key).OpenPath(op, path)
        if (doc === undefined) return
        await this.Provider.get(ArchDiagramBindingService.Key)?.ensureBound(doc)
        await this.Provider.get(DiagramViewpointsEditor.Key)?.edit(doc)
    }
}
