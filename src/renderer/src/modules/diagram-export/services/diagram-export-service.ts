import {
  MetaData, MuralBase, RelayCommand, ServiceBase, ServiceKey,
  type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'
import {
  ContentHostService, DiagramDocument, DialogService,
  type DocumentsContentHostService,
} from '@pragmatic-tech-ai/mural/framework'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import { DiagramSvgRenderer } from './diagram-svg-renderer.js'
import { rasterizeSvgToPng, pngToDataUrl } from './svg-raster.js'
import { buildPptx } from './pptx-builder.js'
import { DiagramExportPreviewModel } from './diagram-export-preview-model.js'
import { ExportFormat, type ExportOptions } from './export-options.js'

// Re-exported so existing importers of `ExportFormat` from this module keep working.
export { ExportFormat } from './export-options.js'

// Exports the active diagram's visual (selection if any, else the whole diagram)
// to SVG or PPTX. Exposes two ICommands bound by the diagram context menu (and,
// in SP2, the title-bar File menu) via `$service(DiagramExportService).…`.
export class DiagramExportService extends ServiceBase
{
  public static readonly Key = new ServiceKey<DiagramExportService>('DiagramExportService')

  public static readonly ExportSvgCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportService, 'ExportSvgCommand', undefined as unknown as ICommand, MetaData.None)
  public static readonly ExportPptxCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportService, 'ExportPptxCommand', undefined as unknown as ICommand, MetaData.None)
  public static readonly OpenExportDialogCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportService, 'OpenExportDialogCommand', undefined as unknown as ICommand, MetaData.None)

  public constructor(provider: IServiceProvider)
  {
    super(provider)
    const gate = (): boolean => this.canExportActive()
    this.set_property_value(DiagramExportService.ExportSvgCommandKey,
      new RelayCommand(() => { void this.exportActive(ExportFormat.Svg) }, gate))
    this.set_property_value(DiagramExportService.ExportPptxCommandKey,
      new RelayCommand(() => { void this.exportActive(ExportFormat.Pptx) }, gate))
    this.set_property_value(DiagramExportService.OpenExportDialogCommandKey,
      new RelayCommand(() => { void this.openExportDialog() }, gate))
  }

  public get ExportSvgCommand(): ICommand { return this.get_property_value(DiagramExportService.ExportSvgCommandKey) }
  public get ExportPptxCommand(): ICommand { return this.get_property_value(DiagramExportService.ExportPptxCommandKey) }
  public get OpenExportDialogCommand(): ICommand { return this.get_property_value(DiagramExportService.OpenExportDialogCommandKey) }

  // The active document if it is a diagram with at least one node, else undefined.
  protected activeDiagram(): DiagramDocument | undefined
  {
    const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
    const doc = host?.ActiveDocument
    if (!(doc instanceof DiagramDocument)) return undefined
    return doc.Nodes.Count > 0 ? doc : undefined
  }

  public canExportActive(): boolean { return this.activeDiagram() !== undefined }

  // Test-only: render the active diagram's SVG synchronously for e2e assertions.
  public _renderSvgForTest(): string | undefined
  {
    const doc = this.activeDiagram()
    return doc ? DiagramSvgRenderer.renderDocument(doc).svg : undefined
  }

  protected async exportActive(format: ExportFormat): Promise<void>
  {
    const doc = this.activeDiagram()
    if (doc === undefined) return
    await this.exportRendered(format, DiagramSvgRenderer.renderDocument(doc), doc.Title || 'diagram')
  }

  // Save an ALREADY-rendered diagram (svg + content size) as SVG or PPTX,
  // prompting for a location with `baseName` as the default filename. Shared by
  // the active-document commands (which render the live diagram) and the
  // project-explorer surface (which renders a .diagram file headlessly via
  // DiagramHeadlessRenderer, without opening it). Renderer-only — the existing
  // fs IPC owns the dialog + write.
  public async exportRendered(
    format: ExportFormat,
    rendered: { svg: string; width: number; height: number },
    baseName: string,
    scale = 2,
  ): Promise<void>
  {
    if (format === ExportFormat.Svg) return this.saveSvg(rendered.svg, baseName)
    if (format === ExportFormat.Png) return this.savePng(rendered, baseName, scale)
    return this.savePptx(rendered, baseName, scale)
  }

  private async saveSvg(svg: string, baseName: string): Promise<void>
  {
    const fs = this.Provider.getRequired(FileSystemService.Key)
    await fs.SaveFileAs(svg, {
      Title:       'Export as SVG',
      DefaultPath: `${baseName}.svg`,
      Filters:     [{ Name: 'SVG Image', Extensions: ['svg'] }],
    })
  }

  // PNG mirrors PPTX's binary two-step: SaveFileAs('') is UTF-8 only, so it just
  // yields the chosen path, then WriteBytes writes the raster.
  private async savePng(
    rendered: { svg: string; width: number; height: number },
    baseName: string,
    scale: number,
  ): Promise<void>
  {
    const { svg, width, height } = rendered
    const png = await rasterizeSvgToPng(svg, width, height, scale)
    const fs = this.Provider.getRequired(FileSystemService.Key)
    const path = await fs.SaveFileAs('', {
      Title:       'Export as PNG',
      DefaultPath: `${baseName}.png`,
      Filters:     [{ Name: 'PNG Image', Extensions: ['png'] }],
    })
    if (path !== null) await fs.WriteBytes(path, png)
  }

  private async savePptx(
    rendered: { svg: string; width: number; height: number },
    baseName: string,
    scale = 2,
  ): Promise<void>
  {
    const { svg, width, height } = rendered
    const png = await rasterizeSvgToPng(svg, width, height, scale)
    const pptx = await buildPptx(pngToDataUrl(png), width, height)
    const fs = this.Provider.getRequired(FileSystemService.Key)
    const path = await fs.SaveFileAs('', {
      Title:       'Export as PowerPoint',
      DefaultPath: `${baseName}.pptx`,
      Filters:     [{ Name: 'PowerPoint Presentation', Extensions: ['pptx'] }],
    })
    if (path !== null) await fs.WriteBytes(path, pptx)
  }

  // Open the preview dialog for the active diagram, then export with the chosen
  // options. No-op when there is no active diagram or no DialogService.
  protected async openExportDialog(): Promise<void>
  {
    const doc = this.activeDiagram()
    if (doc === undefined) return
    const dialogs = this.Provider.get(DialogService.Key) as DialogService | undefined
    if (dialogs === undefined) return

    const baseName = doc.Title || 'diagram'
    const hasSelection = (doc.ActiveView?.SelectionCount ?? 0) > 0
    const vm = new DiagramExportPreviewModel(
      hasSelection,
      this.surfaceHex(),
      (o: ExportOptions) => DiagramSvgRenderer.renderWithOptions(doc, o),
      (o?: ExportOptions) => dialogs.Close(o))

    const chosen = await dialogs.Show<ExportOptions>({
      Title: 'Export diagram', Content: vm, Width: 720, MaxHeight: 560,
    })
    if (chosen === undefined) return
    const rendered = DiagramSvgRenderer.renderWithOptions(doc, chosen)
    await this.exportRendered(chosen.format, rendered, baseName, chosen.scale)
  }

  // The active theme's Surface color as hex, for the Surface-background option.
  private surfaceHex(): string
  {
    const b = Application.current?.Resources?.Resolve('Surface')
    return b instanceof SolidColorBrush ? b.Color.ToHex() : '#1c1b1f'
  }
}
