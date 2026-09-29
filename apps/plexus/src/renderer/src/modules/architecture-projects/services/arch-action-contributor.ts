import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyAction, type IHierarchyActionContributor, type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'
import { ContentNodeKey, type ProjectContentNode } from '@pragmatic-tech-ai/todl'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { DiagramViewpointsEditor } from './diagram-viewpoints-editor.js'

// The "Edit Viewpoints…" action for a .diagram node in an architecture project — the
// INodeCommandContributor replacement on the action seam, keyed on the diagram content
// key. Resolves the member's projected OpenProject, opens/focuses the diagram, ensures
// its arch binding, then runs the shared viewpoints editor.
export class ArchActionContributor extends ServiceBase implements IHierarchyActionContributor
{
    public static readonly Key = new ServiceKey<ArchActionContributor>('ArchActionContributor')
    private static readonly EditViewpointsLabel = 'Edit Viewpoints…'
    private static readonly DiagramExt = '.diagram'
    private static readonly ArchType = 'architecture'

    public constructor(provider: IServiceProvider) { super(provider) }

    public readonly ActionKeys = [ContentNodeKey.Diagram]

    public ActionsFor(vm: HierarchyItemVM): readonly HierarchyAction[]
    {
        const member = FileTreeContributor.MemberOf(vm)
        const node = vm.Data as ProjectContentNode | undefined
        if (member === undefined || node === undefined) return []
        const op = this.Provider.getRequired(ProjectExplorerService.Key).ProjectedOpFor(member)
        if (op === undefined || op.Project.Type !== ArchActionContributor.ArchType) return []
        if (!node.Path.toLowerCase().endsWith(ArchActionContributor.DiagramExt)) return []
        return [HierarchyAction.Command(ArchActionContributor.EditViewpointsLabel, () => void this.edit(op, node.Path))]
    }

    private async edit(op: OpenProject, path: string): Promise<void>
    {
        const doc = await this.Provider.getRequired(ProjectExplorerService.Key).OpenPath(op, path)
        if (doc === undefined) return
        await this.Provider.get(ArchDiagramBindingService.Key)?.ensureBound(doc)
        await this.Provider.get(DiagramViewpointsEditor.Key)?.edit(doc)
    }
}

export default ArchActionContributor
