import { RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { SolutionWorkspaceService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-workspace-service.js'
import { ActiveSolutionMembers } from '../../../services/solution/active-solution-members.js'
import { ContentNodeKey, type ProjectContentNode } from '@pragmatic-tech-ai/todl'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import { ArchDiagramBindingService } from './arch-diagram-binding-service.js'
import { DiagramViewpointsEditor } from './diagram-viewpoints-editor.js'

// The "Edit Viewpoints…" command for a .diagram node in an architecture project — the
// INodeCommandContributor replacement on the command-dispatch seam, Context-tagged to the
// diagram content key. Resolves the member's resolved project, opens/focuses the
// diagram, ensures its arch binding, then runs the shared viewpoints editor. Gating (arch
// project + .diagram) rides the resolved command's CanExecute.
export class ArchActionContributor extends ServiceBase implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<ArchActionContributor>('ArchActionContributor')
    public static readonly EditViewpointsId = 'arch.editViewpoints.node'
    private static readonly DiagramExt = '.diagram'
    private static readonly ArchType = 'architecture'

    public readonly ParentKeys = [ContentNodeKey.Diagram]
    public readonly Order = 100

    public constructor(provider: IServiceProvider) { super(provider) }

    // Action-only: the diagram rows come from the file-tree provider.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        if (commandId !== ArchActionContributor.EditViewpointsId) return undefined
        const anchor = (context as HierarchyActionContext).Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        const node = anchor.ExtObject as ProjectContentNode | undefined
        if (member === undefined || node === undefined) return undefined
        const handle = ActiveSolutionMembers.From(this.Provider).HandleFor(member)
        const canEdit = (): boolean =>
            handle !== undefined
            && handle.Project.Type === ArchActionContributor.ArchType
            && node.Path.toLowerCase().endsWith(ArchActionContributor.DiagramExt)
        return new RelayCommand(() => { if (handle !== undefined) void this.edit(member, node.Path) }, canEdit)
    }

    private async edit(member: SolutionMember, path: string): Promise<void>
    {
        const doc = await this.Provider.getRequired(SolutionWorkspaceService.Key).OpenPath(member, path)
        if (doc === undefined) return
        await this.Provider.get(ArchDiagramBindingService.Key)?.ensureBound(doc)
        await this.Provider.get(DiagramViewpointsEditor.Key)?.edit(doc)
    }
}

export default ArchActionContributor
