import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramExportFormat, type IDiagramTreeExport } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { DiagramHeadlessRenderer } from './diagram-headless-renderer.js'
import { DiagramExportService } from './diagram-export-service.js'
import { ExportFormat } from './export-options.js'

// App-side IDiagramTreeExport: renders a .diagram node headlessly (no editor open)
// and saves it in the chosen format through the shared export pipeline. Wraps
// DiagramHeadlessRenderer + DiagramExportService. Registered under
// DiagramTreeExportKey (see app.mu).
export class DiagramTreeExport extends ServiceBase implements IDiagramTreeExport
{
    public static readonly Key = new ServiceKey<DiagramTreeExport>('DiagramTreeExport')

    public async Export(op: OpenProject, path: string, format: DiagramExportFormat): Promise<void>
    {
        const renderer = this.Provider.getRequired(DiagramHeadlessRenderer.Key)
        const exporter = this.Provider.getRequired(DiagramExportService.Key)
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

    private toExportFormat(format: DiagramExportFormat): ExportFormat
    {
        return format === DiagramExportFormat.Pptx ? ExportFormat.Pptx : ExportFormat.Svg
    }
}

export default DiagramTreeExport
