import { RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { ActiveSolutionMembers, type IProjectHandle } from '../../../services/solution/active-solution-members.js'
import { DiagramExportFormat } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import { ContentNodeKey, type ProjectContentNode } from '@pragmatic-tech-ai/todl'
import { DiagramTreeExport } from './diagram-tree-export.js'

// The "Export ▸ SVG / PowerPoint" command for a .diagram node — the DiagramTreeExportKey
// replacement on the command-dispatch seam, Context-tagged to the diagram content key. The
// Export submenu's two format rows are static (declared in the module's Hierarchy block);
// this contributor resolves each to the headless render + export pipeline (DiagramTreeExport).
export class DiagramExportActionContributor extends ServiceBase implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<DiagramExportActionContributor>('DiagramExportActionContributor')
    public static readonly ExportId = 'diagram.export'
    public static readonly SvgId = 'diagram.export.svg'
    public static readonly PptxId = 'diagram.export.pptx'
    private static readonly DiagramExt = '.diagram'

    public readonly ParentKeys = [ContentNodeKey.Diagram]
    public readonly Order = 200

    public constructor(provider: IServiceProvider) { super(provider) }

    // Action-only: the diagram rows come from the file-tree provider.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const anchor = (context as HierarchyActionContext).Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        const node = anchor.ExtObject as ProjectContentNode | undefined
        if (member === undefined || node === undefined) return undefined
        const op = ActiveSolutionMembers.From(this.Provider).HandleFor(member)
        const isDiagram = (): boolean => op !== undefined && node.Path.toLowerCase().endsWith(DiagramExportActionContributor.DiagramExt)
        switch (commandId)
        {
            case DiagramExportActionContributor.ExportId:
                return new RelayCommand(() => {}, isDiagram)
            case DiagramExportActionContributor.SvgId:
                return new RelayCommand(() => { if (op !== undefined) void this.run(op, node.Path, DiagramExportFormat.Svg) }, isDiagram)
            case DiagramExportActionContributor.PptxId:
                return new RelayCommand(() => { if (op !== undefined) void this.run(op, node.Path, DiagramExportFormat.Pptx) }, isDiagram)
            default:
                return undefined
        }
    }

    private async run(op: IProjectHandle, path: string, format: DiagramExportFormat): Promise<void>
    {
        await this.Provider.get(DiagramTreeExport.Key)?.Export(op, path, format)
    }
}

export default DiagramExportActionContributor
