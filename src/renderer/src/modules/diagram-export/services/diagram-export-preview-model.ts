import {
  MetaData, MuralBase, RelayCommand, type ICommand, type PropertyDescriptor,
} from '@pragmatic-tech-ai/mural/runtime'
import { BitmapImage, Size, type ImageSource } from '@pragmatic-tech-ai/mural/visual-engine'
import {
  ExportFormat, ExportBackground, DEFAULT_EXPORT_OPTIONS, type ExportOptions,
} from './export-options.js'

// View-model for the export preview dialog. Extends MuralBase (not Observable):
// the template two-way-binds each option control and uses `when ( Format = … )`
// triggers, both of which need the DP system — same as SavePromptModel.
//
// It renders a live SVG-data-URL preview through an injected `render` fn (so it is
// testable without a live diagram) whenever an option changes, and resolves the
// chosen ExportOptions on Export / undefined on Cancel.
export class DiagramExportPreviewModel extends MuralBase
{
  static readonly FormatKey = MuralBase.RegisterProperty<ExportFormat>(
    DiagramExportPreviewModel, 'Format', DEFAULT_EXPORT_OPTIONS.format, MetaData.None)
  static readonly UseSelectionKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'UseSelection', false, MetaData.None)
  static readonly BackgroundKey = MuralBase.RegisterProperty<ExportBackground>(
    DiagramExportPreviewModel, 'Background', DEFAULT_EXPORT_OPTIONS.background, MetaData.None)
  static readonly ForegroundChoiceKey = MuralBase.RegisterProperty<string>(
    DiagramExportPreviewModel, 'ForegroundChoice', 'Default', MetaData.None)
  static readonly ShowPageBreaksKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'ShowPageBreaks', DEFAULT_EXPORT_OPTIONS.showPageBreaks, MetaData.None)
  static readonly ScaleKey = MuralBase.RegisterProperty<number>(
    DiagramExportPreviewModel, 'Scale', DEFAULT_EXPORT_OPTIONS.scale, MetaData.None)
  static readonly HasSelectionKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'HasSelection', false, MetaData.None)
  static readonly PreviewKey = MuralBase.RegisterProperty<ImageSource | undefined>(
    DiagramExportPreviewModel, 'Preview', undefined, MetaData.None)
  static readonly PreviewSizeKey = MuralBase.RegisterProperty<string>(
    DiagramExportPreviewModel, 'PreviewSize', '', MetaData.None)
  static readonly ExportCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportPreviewModel, 'ExportCommand', undefined as unknown as ICommand, MetaData.None)
  static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
    DiagramExportPreviewModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

  // Which option DPs, when changed, invalidate the preview.
  private static readonly OPTION_PROPS = new Set(
    ['Format', 'UseSelection', 'Background', 'ForegroundChoice', 'ShowPageBreaks', 'Scale'])

  // Named foreground-ink choices → hex override (undefined = leave the ink as-is).
  // A color swatch bound to a hex string has no clean mural primitive, so the
  // dialog picks a named choice and this maps it to the renderer's ink override.
  private static readonly FOREGROUND_CHOICES = new Map<string, string | undefined>([
    ['Default', undefined], ['Black', '#000000'], ['White', '#ffffff'],
  ])

  // Item lists the ComboBoxes bind to (ItemsSource). These MUST be DPs — a `$Prop`
  // binding resolves against registered properties, not plain getters, so a getter
  // would leave the ComboBox empty. SelectedItem two-way-binds the matching option
  // DP; enum values are their own wire strings, so a selection sets that DP to a
  // valid member directly.
  static readonly FormatsKey = MuralBase.RegisterProperty<ExportFormat[]>(
    DiagramExportPreviewModel, 'Formats', [ExportFormat.Svg, ExportFormat.Png, ExportFormat.Pptx], MetaData.None)
  static readonly BackgroundsKey = MuralBase.RegisterProperty<ExportBackground[]>(
    DiagramExportPreviewModel, 'Backgrounds', [ExportBackground.Transparent, ExportBackground.Surface], MetaData.None)
  static readonly ScalesKey = MuralBase.RegisterProperty<number[]>(
    DiagramExportPreviewModel, 'Scales', [1, 2, 3], MetaData.None)
  static readonly ForegroundChoicesKey = MuralBase.RegisterProperty<string[]>(
    DiagramExportPreviewModel, 'ForegroundChoices', ['Default', 'Black', 'White'], MetaData.None)

  public get Formats(): ExportFormat[] { return this.get_property_value(DiagramExportPreviewModel.FormatsKey) }
  public get Backgrounds(): ExportBackground[] { return this.get_property_value(DiagramExportPreviewModel.BackgroundsKey) }
  public get Scales(): number[] { return this.get_property_value(DiagramExportPreviewModel.ScalesKey) }
  public get ForegroundChoices(): string[] { return this.get_property_value(DiagramExportPreviewModel.ForegroundChoicesKey) }

  // Gate preview recompute until construction has finished seeding the DPs, so the
  // initial preview renders exactly once (not once per seeded option DP).
  private _ready = false

  constructor(
    hasSelection: boolean,
    private readonly backgroundColor: string,
    private readonly render: (o: ExportOptions) => { svg: string; width: number; height: number },
    private readonly close: (o: ExportOptions | undefined) => void,
  )
  {
    super()
    this.set_property_value(DiagramExportPreviewModel.HasSelectionKey, hasSelection)
    this.set_property_value(DiagramExportPreviewModel.UseSelectionKey, hasSelection)
    this.set_property_value(DiagramExportPreviewModel.ExportCommandKey,
      new RelayCommand(() => this.close(this.currentOptions())))
    this.set_property_value(DiagramExportPreviewModel.CancelCommandKey,
      new RelayCommand(() => this.close(undefined)))
    this._ready = true
    this.recomputePreview()
  }

  public get Format(): ExportFormat { return this.get_property_value(DiagramExportPreviewModel.FormatKey) }
  public set Format(v: ExportFormat) { this.set_property_value(DiagramExportPreviewModel.FormatKey, v) }
  public get UseSelection(): boolean { return this.get_property_value(DiagramExportPreviewModel.UseSelectionKey) }
  public set UseSelection(v: boolean) { this.set_property_value(DiagramExportPreviewModel.UseSelectionKey, v) }
  public get Background(): ExportBackground { return this.get_property_value(DiagramExportPreviewModel.BackgroundKey) }
  public set Background(v: ExportBackground) { this.set_property_value(DiagramExportPreviewModel.BackgroundKey, v) }
  public get ForegroundChoice(): string { return this.get_property_value(DiagramExportPreviewModel.ForegroundChoiceKey) }
  public set ForegroundChoice(v: string) { this.set_property_value(DiagramExportPreviewModel.ForegroundChoiceKey, v) }
  public get ShowPageBreaks(): boolean { return this.get_property_value(DiagramExportPreviewModel.ShowPageBreaksKey) }
  public set ShowPageBreaks(v: boolean) { this.set_property_value(DiagramExportPreviewModel.ShowPageBreaksKey, v) }
  public get Scale(): number { return this.get_property_value(DiagramExportPreviewModel.ScaleKey) }
  public set Scale(v: number) { this.set_property_value(DiagramExportPreviewModel.ScaleKey, v) }
  public get HasSelection(): boolean { return this.get_property_value(DiagramExportPreviewModel.HasSelectionKey) }
  public get Preview(): ImageSource | undefined { return this.get_property_value(DiagramExportPreviewModel.PreviewKey) }
  public get PreviewSize(): string { return this.get_property_value(DiagramExportPreviewModel.PreviewSizeKey) }
  public get ExportCommand(): ICommand { return this.get_property_value(DiagramExportPreviewModel.ExportCommandKey) }
  public get CancelCommand(): ICommand { return this.get_property_value(DiagramExportPreviewModel.CancelCommandKey) }

  // The current DP state as an ExportOptions. Surface carries the resolved bg hex;
  // Transparent omits it.
  public currentOptions(): ExportOptions
  {
    const background = this.Background
    return {
      format:         this.Format,
      useSelection:   this.UseSelection,
      background,
      backgroundColor: background === ExportBackground.Surface ? this.backgroundColor : undefined,
      foreground:     DiagramExportPreviewModel.FOREGROUND_CHOICES.get(this.ForegroundChoice),
      showPageBreaks: this.ShowPageBreaks,
      scale:          this.Scale,
    }
  }

  protected override OnPropertyChanged(
    descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
  {
    super.OnPropertyChanged(descriptor, oldValue, newValue)
    if (this._ready && DiagramExportPreviewModel.OPTION_PROPS.has(descriptor.Name)) this.recomputePreview()
  }

  private recomputePreview(): void
  {
    const { svg, width, height } = this.render(this.currentOptions())
    const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    this.set_property_value(DiagramExportPreviewModel.PreviewKey,
      new BitmapImage(uri, new Size(width, height)))
    this.set_property_value(DiagramExportPreviewModel.PreviewSizeKey, `${width} × ${height} px`)
  }
}

export default DiagramExportPreviewModel
