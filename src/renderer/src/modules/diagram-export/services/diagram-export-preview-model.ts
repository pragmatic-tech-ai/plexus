import {
  MetaData, MuralBase, ObservableCollection, RelayCommand, type ICommand, type PropertyDescriptor,
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
  // Each ComboBox binds its SelectedIndex (not SelectedItem) to one of these index
  // DPs. SelectedIndex is the ComboBox's stable selection driver — it survives the
  // items-arrive reconcile (the control re-resolves at SelectedIndex), so the
  // preselected default is never clobbered the way a SelectedItem binding is when it
  // resolves against not-yet-ready items. The value getters (Format/Background/…)
  // read the item at the current index. Defaults: SVG(0), Transparent(0), 2×(idx 1),
  // Default ink(0).
  static readonly FormatIndexKey = MuralBase.RegisterProperty<number>(
    DiagramExportPreviewModel, 'FormatIndex', 0, MetaData.None)
  static readonly UseSelectionKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'UseSelection', false, MetaData.None)
  static readonly BackgroundIndexKey = MuralBase.RegisterProperty<number>(
    DiagramExportPreviewModel, 'BackgroundIndex', 0, MetaData.None)
  static readonly ForegroundIndexKey = MuralBase.RegisterProperty<number>(
    DiagramExportPreviewModel, 'ForegroundIndex', 0, MetaData.None)
  static readonly ShowPageBreaksKey = MuralBase.RegisterProperty<boolean>(
    DiagramExportPreviewModel, 'ShowPageBreaks', DEFAULT_EXPORT_OPTIONS.showPageBreaks, MetaData.None)
  static readonly ScaleIndexKey = MuralBase.RegisterProperty<number>(
    DiagramExportPreviewModel, 'ScaleIndex', 1, MetaData.None)
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
    ['FormatIndex', 'UseSelection', 'BackgroundIndex', 'ForegroundIndex', 'ShowPageBreaks', 'ScaleIndex'])

  // Named foreground-ink choices → hex override (undefined = leave the ink as-is).
  // A color swatch bound to a hex string has no clean mural primitive, so the
  // dialog picks a named choice and this maps it to the renderer's ink override.
  private static readonly FOREGROUND_CHOICES = new Map<string, string | undefined>([
    ['Default', undefined], ['Black', '#000000'], ['White', '#ffffff'],
  ])

  // Item lists the ComboBoxes bind to (ItemsSource). These MUST be DPs holding an
  // ObservableCollection — a `$Prop` binding resolves against registered properties
  // (a plain getter binds empty), and the ComboBox resolves its initial SelectedItem
  // against a collection whose population it observes (a plain array set once leaves
  // the default unselected). Seeded in the constructor. SelectedItem two-way-binds
  // the matching option DP; enum values are their own wire strings, so a selection
  // sets that DP to a valid member directly.
  static readonly FormatsKey = MuralBase.RegisterProperty<ObservableCollection<ExportFormat> | undefined>(
    DiagramExportPreviewModel, 'Formats', undefined, MetaData.None)
  static readonly BackgroundsKey = MuralBase.RegisterProperty<ObservableCollection<ExportBackground> | undefined>(
    DiagramExportPreviewModel, 'Backgrounds', undefined, MetaData.None)
  static readonly ScalesKey = MuralBase.RegisterProperty<ObservableCollection<number> | undefined>(
    DiagramExportPreviewModel, 'Scales', undefined, MetaData.None)
  static readonly ForegroundChoicesKey = MuralBase.RegisterProperty<ObservableCollection<string> | undefined>(
    DiagramExportPreviewModel, 'ForegroundChoices', undefined, MetaData.None)

  public get Formats(): ObservableCollection<ExportFormat> | undefined { return this.get_property_value(DiagramExportPreviewModel.FormatsKey) }
  public get Backgrounds(): ObservableCollection<ExportBackground> | undefined { return this.get_property_value(DiagramExportPreviewModel.BackgroundsKey) }
  public get Scales(): ObservableCollection<number> | undefined { return this.get_property_value(DiagramExportPreviewModel.ScalesKey) }
  public get ForegroundChoices(): ObservableCollection<string> | undefined { return this.get_property_value(DiagramExportPreviewModel.ForegroundChoicesKey) }

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
    // Seed the ComboBox item lists.
    this.set_property_value(DiagramExportPreviewModel.FormatsKey,
      new ObservableCollection<ExportFormat>([ExportFormat.Svg, ExportFormat.Png, ExportFormat.Pptx]))
    this.set_property_value(DiagramExportPreviewModel.BackgroundsKey,
      new ObservableCollection<ExportBackground>([ExportBackground.Transparent, ExportBackground.Surface]))
    this.set_property_value(DiagramExportPreviewModel.ScalesKey,
      new ObservableCollection<number>([1, 2, 3]))
    this.set_property_value(DiagramExportPreviewModel.ForegroundChoicesKey,
      new ObservableCollection<string>([...DiagramExportPreviewModel.FOREGROUND_CHOICES.keys()]))
    // Seed the selected indices as LOCAL values (not just registered defaults) so
    // each ComboBox's SelectedIndex binding reads a concrete index and preselects it.
    this.set_property_value(DiagramExportPreviewModel.FormatIndexKey, 0)
    this.set_property_value(DiagramExportPreviewModel.BackgroundIndexKey, 0)
    this.set_property_value(DiagramExportPreviewModel.ScaleIndexKey, this.Scales!.IndexOf(DEFAULT_EXPORT_OPTIONS.scale))
    this.set_property_value(DiagramExportPreviewModel.ForegroundIndexKey, 0)
    this.set_property_value(DiagramExportPreviewModel.HasSelectionKey, hasSelection)
    this.set_property_value(DiagramExportPreviewModel.UseSelectionKey, hasSelection)
    this.set_property_value(DiagramExportPreviewModel.ExportCommandKey,
      new RelayCommand(() => this.close(this.currentOptions())))
    this.set_property_value(DiagramExportPreviewModel.CancelCommandKey,
      new RelayCommand(() => this.close(undefined)))
    this._ready = true
    this.recomputePreview()
  }

  // Index DPs the ComboBoxes two-way-bind via SelectedIndex.
  public get FormatIndex(): number { return this.get_property_value(DiagramExportPreviewModel.FormatIndexKey) }
  public set FormatIndex(v: number) { this.set_property_value(DiagramExportPreviewModel.FormatIndexKey, v) }
  public get BackgroundIndex(): number { return this.get_property_value(DiagramExportPreviewModel.BackgroundIndexKey) }
  public set BackgroundIndex(v: number) { this.set_property_value(DiagramExportPreviewModel.BackgroundIndexKey, v) }
  public get ForegroundIndex(): number { return this.get_property_value(DiagramExportPreviewModel.ForegroundIndexKey) }
  public set ForegroundIndex(v: number) { this.set_property_value(DiagramExportPreviewModel.ForegroundIndexKey, v) }
  public get ScaleIndex(): number { return this.get_property_value(DiagramExportPreviewModel.ScaleIndexKey) }
  public set ScaleIndex(v: number) { this.set_property_value(DiagramExportPreviewModel.ScaleIndexKey, v) }

  // Value views over the item lists at the current index. Setters map a value back
  // to its index (clamped to 0 so a miss falls to the first item).
  public get Format(): ExportFormat { return this.Formats?.Get(this.FormatIndex) ?? ExportFormat.Svg }
  public set Format(v: ExportFormat) { this.FormatIndex = Math.max(0, this.Formats?.IndexOf(v) ?? 0) }
  public get Background(): ExportBackground { return this.Backgrounds?.Get(this.BackgroundIndex) ?? ExportBackground.Transparent }
  public set Background(v: ExportBackground) { this.BackgroundIndex = Math.max(0, this.Backgrounds?.IndexOf(v) ?? 0) }
  public get ForegroundChoice(): string { return this.ForegroundChoices?.Get(this.ForegroundIndex) ?? 'Default' }
  public set ForegroundChoice(v: string) { this.ForegroundIndex = Math.max(0, this.ForegroundChoices?.IndexOf(v) ?? 0) }
  public get Scale(): number { return this.Scales?.Get(this.ScaleIndex) ?? DEFAULT_EXPORT_OPTIONS.scale }
  public set Scale(v: number) { this.ScaleIndex = Math.max(0, this.Scales?.IndexOf(v) ?? 0) }

  public get UseSelection(): boolean { return this.get_property_value(DiagramExportPreviewModel.UseSelectionKey) }
  public set UseSelection(v: boolean) { this.set_property_value(DiagramExportPreviewModel.UseSelectionKey, v) }
  public get ShowPageBreaks(): boolean { return this.get_property_value(DiagramExportPreviewModel.ShowPageBreaksKey) }
  public set ShowPageBreaks(v: boolean) { this.set_property_value(DiagramExportPreviewModel.ShowPageBreaksKey, v) }
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
