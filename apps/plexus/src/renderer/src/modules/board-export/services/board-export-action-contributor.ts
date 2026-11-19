import { RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { ActiveSolutionMembers, type IProjectHandle } from '../../../services/solution/active-solution-members.js'
import { BoardExportFormat } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import { ContentNodeKey, type ProjectContentNode } from '@pragmatic-tech-ai/todl'
import { BoardTreeExport } from './board-tree-export.js'

// The "Export ▸ SVG / PowerPoint" command for a .board node — the BoardTreeExportKey
// replacement on the command-dispatch seam, Context-tagged to the board content key. The
// Export submenu's two format rows are static (declared in the module's Hierarchy block);
// this contributor resolves each to the headless render + export pipeline (BoardTreeExport).
export class BoardExportActionContributor extends ServiceBase implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<BoardExportActionContributor>('BoardExportActionContributor')
    public static readonly ExportId = 'board.export'
    public static readonly SvgId = 'board.export.svg'
    public static readonly PptxId = 'board.export.pptx'
    // Canonical `.board` plus the legacy `.diagram` still readable as a board.
    private static readonly BoardExts: readonly string[] = ['.board', '.diagram']

    public readonly ParentKeys = [ContentNodeKey.Board]
    public readonly Order = 200

    public constructor(provider: IServiceProvider) { super(provider) }

    // Action-only: the board rows come from the file-tree provider.
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
        const isBoard = (): boolean => op !== undefined && BoardExportActionContributor.BoardExts.some((e) => node.Path.toLowerCase().endsWith(e))
        switch (commandId)
        {
            case BoardExportActionContributor.ExportId:
                return new RelayCommand(() => {}, isBoard)
            case BoardExportActionContributor.SvgId:
                return new RelayCommand(() => { if (op !== undefined) void this.run(op, node.Path, BoardExportFormat.Svg) }, isBoard)
            case BoardExportActionContributor.PptxId:
                return new RelayCommand(() => { if (op !== undefined) void this.run(op, node.Path, BoardExportFormat.Pptx) }, isBoard)
            default:
                return undefined
        }
    }

    private async run(op: IProjectHandle, path: string, format: BoardExportFormat): Promise<void>
    {
        await this.Provider.get(BoardTreeExport.Key)?.Export(op, path, format)
    }
}

export default BoardExportActionContributor
