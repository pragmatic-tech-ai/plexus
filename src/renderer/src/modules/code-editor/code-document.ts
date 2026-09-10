import { MuralBase, MetaData, ObservableCollection, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { ICodeFile } from './code-file.js'
import type { EditorDiagnostic } from './editor-diagnostic.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

function fileName(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// Minimal file-extension → Monaco language id. Unknown extensions fall back to
// plaintext. `todl` maps to the meta-model module's registered language.
const LANGUAGE_BY_EXT: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', xml: 'xml',
    py: 'python', yaml: 'yaml', yml: 'yaml', todl: 'todl',
    mu: 'mural', mural: 'mural',   // mural view/resource files (registerMuralLanguage)
}

function languageForPath(path: string): string
{
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    return LANGUAGE_BY_EXT[ext] ?? 'plaintext'
}

// A file opened in the editor, modeled as an IDocument so it shows as a tab in
// the shell's content host alongside diagrams and settings. It is the VM: it
// OWNS the text (Content) and the load/save/dirty lifecycle — exactly as a
// DiagramDocument owns its Nodes. The view is a CodeEditor declared in
// DataTemplate[CodeDocument] that binds $Content (TwoWay), $Language, and
// $Diagnostics; the document never touches the editor.
//
// Persistence flows through an injected ICodeFile, so the document is agnostic
// to whether its bytes live on the raw file system (FileSystemCodeFile) or in a
// project's rooted IStorage (StorageCodeFile). Id / Title / IsDirty / Content /
// Language / Diagnostics are DP-backed: the tab strip binds Id / Title, the
// editor binds Content / Language / Diagnostics. Id is the file's identity, so
// re-opening dedupes to one tab.
export class CodeDocument extends MuralBase implements IDocument
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        CodeDocument, 'Id', '', MetaData.None)

    // A stable, project-scoped document URI (todl://<projectKey>/<relpath>) the
    // editor keys its Monaco model on, so language-server requests, diagnostics,
    // and edits all map back to this file. Empty ⇒ anonymous model (non-.todl).
    public static readonly UriKey = MuralBase.RegisterProperty<string>(
        CodeDocument, 'Uri', '', MetaData.None)

    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        CodeDocument, 'Title', '', MetaData.None)

    public static readonly IsDirtyKey = MuralBase.RegisterProperty<boolean>(
        CodeDocument, 'IsDirty', false, MetaData.None)

    // The text — the source of truth. The editor two-way binds this, so its
    // edits land here; Save() persists it and load() seeds it from the file.
    public static readonly ContentKey = MuralBase.RegisterProperty<string>(
        CodeDocument, 'Content', '', MetaData.None)

    // Monaco language id, derived from the extension; the editor binds it.
    public static readonly LanguageKey = MuralBase.RegisterProperty<string>(
        CodeDocument, 'Language', 'plaintext', MetaData.None)

    // Diagnostics against the current text — a generic channel a validation
    // producer (e.g. the meta-model validator) fills; the editor binds it and
    // renders the entries as Monaco markers. Empty ⇒ no squiggles. Nothing in
    // the generic code path writes here; a producer replaces the collection's
    // contents on each pass.
    public static readonly DiagnosticsKey = MuralBase.RegisterProperty<ObservableCollection<EditorDiagnostic>>(
        CodeDocument, 'Diagnostics', undefined as unknown as ObservableCollection<EditorDiagnostic>, MetaData.None)

    // A one-shot reveal request (line/column, 1-based) the editor honors to scroll
    // to + select a span — used by the Problems dock to navigate to a diagnostic.
    // The editor listens for changes; the value carries a monotonic seq so repeated
    // reveals to the same position still fire a change.
    public static readonly RevealRequestKey = MuralBase.RegisterProperty<{ line: number; column: number; seq: number } | undefined>(
        CodeDocument, 'RevealRequest', undefined, MetaData.None)

    private readonly file: ICodeFile
    // Last value written to / read from the file. IsDirty = Content !== this.
    private savedContent = ''

    constructor(file: ICodeFile)
    {
        super()
        this.file = file
        this.set_property_value(CodeDocument.IdKey, file.id)
        this.set_property_value(CodeDocument.TitleKey, fileName(file.id))
        this.set_property_value(CodeDocument.LanguageKey, languageForPath(file.id))
        this.set_property_value(CodeDocument.DiagnosticsKey, new ObservableCollection<EditorDiagnostic>())
        void this.load()
    }

    public get Id(): string { return this.get_property_value(CodeDocument.IdKey) }

    public get Uri(): string { return this.get_property_value(CodeDocument.UriKey) }
    public set Uri(v: string) { this.set_property_value(CodeDocument.UriKey, v) }

    public get Title(): string { return this.get_property_value(CodeDocument.TitleKey) }

    public get IsDirty(): boolean { return this.get_property_value(CodeDocument.IsDirtyKey) }

    public get Content(): string { return this.get_property_value(CodeDocument.ContentKey) }
    public set Content(v: string) { this.set_property_value(CodeDocument.ContentKey, v) }

    public get Language(): string { return this.get_property_value(CodeDocument.LanguageKey) }

    public get Diagnostics(): ObservableCollection<EditorDiagnostic> { return this.get_property_value(CodeDocument.DiagnosticsKey) }

    public get RevealRequest(): { line: number; column: number; seq: number } | undefined
    { return this.get_property_value(CodeDocument.RevealRequestKey) }

    private revealSeq = 0

    // Ask a bound editor to scroll to + select (line, column) — both 1-based.
    public RequestReveal(line: number, column: number): void
    {
        this.revealSeq += 1
        this.set_property_value(CodeDocument.RevealRequestKey, { line, column, seq: this.revealSeq })
    }

    // Re-point this document at a new path after an in-place rename (same
    // storage): re-target the underlying file (so saves go to the new location)
    // and refresh the identity DPs. The in-memory Content/dirty state is preserved.
    public Relocate(newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: unknown): void }>).Retarget?.(newPath)
        this.refreshIdentity(newPath)
    }

    // Re-point at a new STORAGE + path after a cross-project move; the tab stays
    // open (Content/dirty preserved) and now saves to the new project's storage.
    public RelocateTo(storage: IStorage, newPath: string): void
    {
        (this.file as Partial<{ Retarget(id: string, storage?: IStorage): void }>).Retarget?.(newPath, storage)
        this.refreshIdentity(newPath)
    }

    // Refresh the identity DPs: Id dedupes tabs, Title labels the tab, Language
    // re-infers from the new extension.
    private refreshIdentity(newPath: string): void
    {
        this.set_property_value(CodeDocument.IdKey, newPath)
        this.set_property_value(CodeDocument.TitleKey, fileName(newPath))
        this.set_property_value(CodeDocument.LanguageKey, languageForPath(newPath))
    }

    public async Save(): Promise<void>
    {
        const text = this.Content
        await this.file.write(text)
        this.savedContent = text
        this.set_property_value(CodeDocument.IsDirtyKey, false)
    }

    // Re-read the buffer from disk (external change). Discards any in-memory edits
    // — callers gate on IsDirty and prompt first when that matters.
    public async Reload(): Promise<void>
    {
        await this.load()
    }

    // Seed Content from the file (empty on miss / error). The write goes through
    // the DP so a bound editor picks it up; savedContent is set so this initial
    // fill reads as clean, not a user edit.
    private async load(): Promise<void>
    {
        const text = await this.file.read().catch(() => '')
        this.savedContent = text
        this.set_property_value(CodeDocument.ContentKey, text)
        this.set_property_value(CodeDocument.IsDirtyKey, false)
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        // Any Content change (a user edit arriving through the two-way binding)
        // updates dirty by comparing against what's on the file.
        if (descriptor.Name === 'Content')
        {
            this.set_property_value(
                CodeDocument.IsDirtyKey, (newValue as string) !== this.savedContent)
        }
    }
}
