import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { BoardExportFormat, type IBoardTreeExport } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import type { IProjectHandle } from '../../../services/solution/active-solution-members.js'
import { BoardHeadlessRenderer } from './board-headless-renderer.js'
import { BoardExportService } from './board-export-service.js'
import { ExportFormat } from './export-options.js'

// App-side IBoardTreeExport: renders a .board node headlessly (no editor open)
// and saves it in the chosen format through the shared export pipeline. Wraps
// BoardHeadlessRenderer + BoardExportService. Registered under
// BoardTreeExportKey (see app.mu).
export class BoardTreeExport extends ServiceBase implements IBoardTreeExport
{
    public static readonly Key = new ServiceKey<BoardTreeExport>('BoardTreeExport')

    public async Export(op: IProjectHandle, path: string, format: BoardExportFormat): Promise<void>
    {
        const renderer = this.Provider.getRequired(BoardHeadlessRenderer.Key)
        const exporter = this.Provider.getRequired(BoardExportService.Key)
        const rendered = await renderer.renderFile(op, path)
        if (rendered === undefined) return
        await exporter.exportRendered(this.toExportFormat(format), rendered, this.baseName(path))
    }

    // The export file name: the node's basename without extension.
    private baseName(path: string): string
    {
        const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
        const file = slash >= 0 ? path.slice(slash + 1) : path
        const dot = file.lastIndexOf('.')
        return dot > 0 ? file.slice(0, dot) : file
    }

    private toExportFormat(format: BoardExportFormat): ExportFormat
    {
        return format === BoardExportFormat.Pptx ? ExportFormat.Pptx : ExportFormat.Svg
    }
}

export default BoardTreeExport
