import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyAction, type IHierarchyActionContributor, type HierarchyActionContext } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'
import { DiagramExportFormat } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import { ContentNodeKey, type ProjectContentNode } from '@pragmatic-tech-ai/todl'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { DiagramTreeExport } from './diagram-tree-export.js'

// The "Export ▸ SVG / PowerPoint" action for a .diagram node — the DiagramTreeExportKey
// replacement on the action seam, keyed on the diagram content key. Resolves the member's
// projected OpenProject and delegates to the headless render + export pipeline
// (DiagramTreeExport).
export class DiagramExportActionContributor extends ServiceBase implements IHierarchyActionContributor
{
    public static readonly Key = new ServiceKey<DiagramExportActionContributor>('DiagramExportActionContributor')
    private static readonly ExportLabel = 'Export'
    private static readonly SvgLabel = 'SVG'
    private static readonly PptxLabel = 'PowerPoint (PPTX)'
    private static readonly DiagramExt = '.diagram'

    public constructor(provider: IServiceProvider) { super(provider) }

    public readonly ActionKeys = [ContentNodeKey.Diagram]

    public ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]
    {
        const vm = context.Anchor
        const member = FileTreeContributor.MemberOf(vm)
        const node = vm.Data as ProjectContentNode | undefined
        if (member === undefined || node === undefined) return []
        const op = this.Provider.getRequired(ProjectExplorerService.Key).ProjectedOpFor(member)
        if (op === undefined || !node.Path.toLowerCase().endsWith(DiagramExportActionContributor.DiagramExt)) return []
        const exportAction = HierarchyAction.Command(DiagramExportActionContributor.ExportLabel, () => {})
        exportAction.Children.Add(HierarchyAction.Command(DiagramExportActionContributor.SvgLabel, () => void this.run(op, node.Path, DiagramExportFormat.Svg)))
        exportAction.Children.Add(HierarchyAction.Command(DiagramExportActionContributor.PptxLabel, () => void this.run(op, node.Path, DiagramExportFormat.Pptx)))
        return [exportAction]
    }

    private async run(op: OpenProject, path: string, format: DiagramExportFormat): Promise<void>
    {
        await this.Provider.get(DiagramTreeExport.Key)?.Export(op, path, format)
    }
}

export default DiagramExportActionContributor
