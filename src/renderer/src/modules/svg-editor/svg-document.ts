import { MuralBase, MetaData, ObservableCollection, RelayCommand, type ICommand, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { ICodeFile } from '../code-editor/code-file.js'
import type { EditorDiagnostic } from '../code-editor/editor-diagnostic.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SvgViewKind } from './svg-view-kind.js'
import { SvgFormatSink } from './svg-format-sink.js'

// A .svg file opened as one document with two stacked sub-views (visual /
// text). The markup is the single source of truth, held in Content — named to
// match CodeEditor's DataContextBinding so the text tab is a bare CodeEditor
// with no adapter. Persistence flows through an injected ICodeFile exactly like
// CodeDocument, so Save/Relocate come for free. Extends MuralBase (not
// Observable) because IDocument state here is two-way-bindable DPs.
export class SvgDocument extends MuralBase implements IDocument
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        SvgDocument, 'Id', '', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        SvgDocument, 'Title', '', MetaData.None)
    public static readonly IsDirtyKey = MuralBase.RegisterProperty<boolean>(
        SvgDocument, 'IsDirty', false, MetaData.None)

    // The SVG markup — the source of truth. The text tab's CodeEditor binds this
    // TwoWay (as $Content); the visual tab parses it into the live scene.
    public static readonly ContentKey = MuralBase.RegisterProperty<string>(
        SvgDocument, 'Content', '', MetaData.None)
    // CodeEditor binding surface: Monaco language + (unused here) model uri +
    // diagnostics channel. Fixed to 'xml'; empty uri ⇒ anonymous model.
    public static readonly LanguageKey = MuralBase.RegisterProperty<string>(
        SvgDocument, 'Language', 'xml', MetaData.None)
    public static readonly UriKey = MuralBase.RegisterProperty<string>(
        SvgDocument, 'Uri', '', MetaData.None)
    public static readonly DiagnosticsKey = MuralBase.RegisterProperty<ObservableCollection<EditorDiagnostic>>(
        SvgDocument, 'Diagnostics', undefined as unknown as ObservableCollection<EditorDiagnostic>, MetaData.None)

    // Which sub-view shows, plus the derived booleans the .mu binds to
    // Visibility (via ToVisibility) and the tab buttons' selected state.
    public static readonly ActiveViewKey = MuralBase.RegisterProperty<SvgViewKind>(
        SvgDocument, 'ActiveView', SvgViewKind.Visual, MetaData.None)
    public static readonly IsVisualActiveKey = MuralBase.RegisterProperty<boolean>(
        SvgDocument, 'IsVisualActive', true, MetaData.None)
    public static readonly IsTextActiveKey = MuralBase.RegisterProperty<boolean>(
        SvgDocument, 'IsTextActive', false, MetaData.None)

    // The bottom tab-strip commands. Exposed as DPs (not plain getters) so the
    // markup's Button `Command = $ShowVisualCommand` binding resolves — mural's
    // binding engine resolves dependency properties, not bare JS accessors.
    public static readonly ShowVisualCommandKey = MuralBase.RegisterProperty<ICommand>(
        SvgDocument, 'ShowVisualCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly ShowTextCommandKey = MuralBase.RegisterProperty<ICommand>(
        SvgDocument, 'ShowTextCommand', undefined as unknown as ICommand, MetaData.None)

    // The Format Shape sink for the current visual selection. The .mu binds a
    // ShapeFormatControl's Fill/Stroke to it (via DataContext = $SelectionStyle);
    // the SvgSceneHost loads it from the selection and applies its edits back.
    public static readonly SelectionStyleKey = MuralBase.RegisterProperty<SvgFormatSink>(
        SvgDocument, 'SelectionStyle', undefined as unknown as SvgFormatSink, MetaData.None)

    // Whether a visual part is selected — drives the inspector rail's visibility.
    // A document-level DP (single-level binding) so the .mu reacts reliably to it
    // (a dotted `$SelectionStyle.HasSelection` path did not update the view).
    public static readonly HasSelectionKey = MuralBase.RegisterProperty<boolean>(
        SvgDocument, 'HasSelection', false, MetaData.None)

    private readonly file: ICodeFile
    private savedContent = ''

    public constructor(file: ICodeFile)
    {
        super()
        this.file = file
        this.set_property_value(SvgDocument.IdKey, file.id)
        this.set_property_value(SvgDocument.TitleKey, SvgDocument.fileName(file.id))
        this.set_property_value(SvgDocument.DiagnosticsKey, new ObservableCollection<EditorDiagnostic>())
        this.set_property_value(SvgDocument.SelectionStyleKey, new SvgFormatSink())
        this.set_property_value(SvgDocument.ShowVisualCommandKey, new RelayCommand(() => this.ShowVisual()))
        this.set_property_value(SvgDocument.ShowTextCommandKey, new RelayCommand(() => this.ShowText()))
        void this.load()
    }

    public get Id(): string { return this.get_property_value(SvgDocument.IdKey) }
    public get Title(): string { return this.get_property_value(SvgDocument.TitleKey) }
    public get IsDirty(): boolean { return this.get_property_value(SvgDocument.IsDirtyKey) }

    public get Content(): string { return this.get_property_value(SvgDocument.ContentKey) }
    public set Content(v: string) { this.set_property_value(SvgDocument.ContentKey, v) }

    public get Language(): string { return this.get_property_value(SvgDocument.LanguageKey) }
    public get Uri(): string { return this.get_property_value(SvgDocument.UriKey) }
    public get Diagnostics(): ObservableCollection<EditorDiagnostic> { return this.get_property_value(SvgDocument.DiagnosticsKey) }

    public get ActiveView(): SvgViewKind { return this.get_property_value(SvgDocument.ActiveViewKey) }
    public get IsVisualActive(): boolean { return this.get_property_value(SvgDocument.IsVisualActiveKey) }
    public get IsTextActive(): boolean { return this.get_property_value(SvgDocument.IsTextActiveKey) }

    public get SelectionStyle(): SvgFormatSink { return this.get_property_value(SvgDocument.SelectionStyleKey) }

    public get HasSelection(): boolean { return this.get_property_value(SvgDocument.HasSelectionKey) }
    public set HasSelection(v: boolean) { this.set_property_value(SvgDocument.HasSelectionKey, v) }

    public get ShowVisualCommand(): ICommand { return this.get_property_value(SvgDocument.ShowVisualCommandKey) }
    public get ShowTextCommand(): ICommand { return this.get_property_value(SvgDocument.ShowTextCommandKey) }

    public ShowVisual(): void { this.set_property_value(SvgDocument.ActiveViewKey, SvgViewKind.Visual) }
    public ShowText(): void { this.set_property_value(SvgDocument.ActiveViewKey, SvgViewKind.Text) }

    public async Save(): Promise<void>
    {
        const text = this.Content
        await this.file.write(text)
        this.savedContent = text
        this.set_property_value(SvgDocument.IsDirtyKey, false)
    }

    // In-place rename (same storage): re-target the file and refresh identity.
    public Relocate(newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: unknown): void }>).Retarget?.(newPath)
        this.refreshIdentity(newPath)
    }

    // Cross-project move: re-target storage + path, tab stays open.
    public RelocateTo(storage: IStorage, newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: IStorage): void }>).Retarget?.(newPath, storage)
        this.refreshIdentity(newPath)
    }

    private refreshIdentity(newPath: string): void
    {
        this.set_property_value(SvgDocument.IdKey, newPath)
        this.set_property_value(SvgDocument.TitleKey, SvgDocument.fileName(newPath))
    }

    private async load(): Promise<void>
    {
        const text = await this.file.read().catch(() => '')
        this.savedContent = text
        this.set_property_value(SvgDocument.ContentKey, text)
        this.set_property_value(SvgDocument.IsDirtyKey, false)
    }

    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name === 'Content')
        {
            this.set_property_value(SvgDocument.IsDirtyKey, (newValue as string) !== this.savedContent)
        }
        else if (descriptor.Name === 'ActiveView')
        {
            const visual = (newValue as SvgViewKind) === SvgViewKind.Visual
            this.set_property_value(SvgDocument.IsVisualActiveKey, visual)
            this.set_property_value(SvgDocument.IsTextActiveKey, !visual)
        }
    }

    private static fileName(path: string): string
    {
        const parts = path.split(/[\\/]/)
        return parts[parts.length - 1] || path
    }
}
