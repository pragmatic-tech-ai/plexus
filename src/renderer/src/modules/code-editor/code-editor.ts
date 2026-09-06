import * as monaco from 'monaco-editor'
import './monaco-env.js'
import { DomHost } from '@pragmatic-tech-ai/mural/basic'
import { Color, DataContextBinding, MuralBase, MetaData, ObservableCollection, Size, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import { SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'
import { toMarkers, markerSignature, type EditorDiagnostic } from './editor-diagnostic.js'
import { handleCrossFileOpen, type CrossFileSelection } from './cross-file-open.js'
import { todlSemanticThemeRules } from '../../services/todl/semantic-scopes.js'

// The Monaco theme name this control defines from mural's resolved tokens.
const MURAL_THEME = 'mural'

// Owner id for the markers this control sets — namespaces our diagnostics so
// setModelMarkers replaces only ours, never another provider's.
const MARKER_OWNER = 'meta-model'

// A DomHost that hosts a Monaco editor. It IS the foreign control — overriding
// DomHost.CreateHostElement to build Monaco inside the slot-filling host
// element. It is a pure VIEW: the document (its DataContext) owns the text and
// save/dirty, exactly as a Diagram binds a DiagramDocument's Nodes. The editor
// is declared directly in DataTemplate[CodeDocument] and configured by property
// bindings:
//
//     CodeEditor [ Text = $Content, Language = $Language ]
//
// Text is BindsTwoWayByDefault, so a user's edits flow back into the document's
// Content DP without an explicit binding mode. Monaco ↔ Text stays in sync
// through an `updating` guard that suppresses the echo in whichever direction
// isn't the origin of a given change.
export class CodeEditor extends DomHost
{
    // The editor's text, TwoWay by default: the document binds $Content here and
    // receives edits back through the same binding.
    public static readonly TextKey = MuralBase.RegisterProperty<string>(
        CodeEditor, 'Text', '', MetaData.BindsTwoWayByDefault)

    // Monaco language id (e.g. 'typescript'). The document derives it from the
    // file extension and binds $Language.
    public static readonly LanguageKey = MuralBase.RegisterProperty<string>(
        CodeEditor, 'Language', 'plaintext', MetaData.None)

    // Stable model URI (bound from the document's $Uri). When set, the Monaco
    // model is created/looked up by this URI so language-server providers,
    // diagnostics, and edits key on it. Empty ⇒ anonymous model (back-compat).
    public static readonly ModelUriKey = MuralBase.RegisterProperty<string>(
        CodeEditor, 'ModelUri', '', MetaData.None)

    // Diagnostics against the text — the document binds its Diagnostics channel
    // here; we render them as Monaco markers. It is one ObservableCollection
    // instance whose CONTENTS change (Clear/Add) rather than being replaced, so
    // we subscribe to the collection, not just the DP.
    public static readonly DiagnosticsKey = MuralBase.RegisterProperty<ObservableCollection<EditorDiagnostic>>(
        CodeEditor, 'Diagnostics', undefined as unknown as ObservableCollection<EditorDiagnostic>, MetaData.None)

    // A one-shot reveal request from the document (Problems-dock navigation): the
    // document binds its RevealRequest here; on change we scroll to + select it.
    public static readonly RevealRequestKey = MuralBase.RegisterProperty<{ line: number; column: number; seq: number } | undefined>(
        CodeEditor, 'RevealRequest', undefined, MetaData.None)

    private editor: monaco.editor.IStandaloneCodeEditor | undefined
    // True when we created the editor's model from a stable URI (so we own its
    // disposal — URI-keyed models persist in Monaco's registry otherwise).
    private ownsModel = false
    // True while WE push a change across the Monaco↔DP boundary, so the
    // resulting echo on the other side is ignored (no feedback loop).
    private updating = false
    // Unsubscribe from the currently-bound Diagnostics collection.
    private diagUnsub: (() => void) | undefined
    // Coalesces bursts of diagnostics changes into one marker update, and the
    // signature of the last-applied marker set so an unchanged re-publish (a
    // common project-rescan case) skips setModelMarkers entirely — each apply
    // forces a Monaco decoration re-render, a measured CPU hotspot.
    private markerTimer: ReturnType<typeof setTimeout> | undefined
    private lastMarkerSig: string | undefined

    // The editor is declared bare in DataTemplate[CodeDocument] and binds itself
    // to its DataContext (the document) here. This is exactly what markup
    // `Text = $Content, Language = $Language` would emit — relocated into the
    // control because the .mu compiler can't resolve an app-local control's DP
    // metadata to bind its properties in markup (only framework controls). Text
    // is BindsTwoWayByDefault, so edits flow back to the document's Content.
    constructor()
    {
        super()
        // `as unknown as T`: set_property_value accepts a Binding at runtime
        // (MuralBase special-cases `value instanceof Binding`); the cast satisfies
        // its typed signature — the same idiom mural uses (inspector-stack.ts).
        this.set_property_value(
            CodeEditor.TextKey, DataContextBinding(this, 'Content') as unknown as string)
        this.set_property_value(
            CodeEditor.LanguageKey, DataContextBinding(this, 'Language') as unknown as string)
        this.set_property_value(
            CodeEditor.ModelUriKey, DataContextBinding(this, 'Uri') as unknown as string)
        this.set_property_value(
            CodeEditor.DiagnosticsKey,
            DataContextBinding(this, 'Diagnostics') as unknown as ObservableCollection<EditorDiagnostic>)
        this.set_property_value(
            CodeEditor.RevealRequestKey,
            DataContextBinding(this, 'RevealRequest') as unknown as { line: number; column: number; seq: number } | undefined)
    }

    public get Text(): string { return this.get_property_value(CodeEditor.TextKey) }
    public set Text(v: string) { this.set_property_value(CodeEditor.TextKey, v) }

    public get Language(): string { return this.get_property_value(CodeEditor.LanguageKey) }
    public set Language(v: string) { this.set_property_value(CodeEditor.LanguageKey, v) }

    public get Diagnostics(): ObservableCollection<EditorDiagnostic> | undefined
    {
        return this.get_property_value(CodeEditor.DiagnosticsKey)
    }

    // Build the host element (DomHost's sized container) and mount Monaco into
    // it, seeded from the current Text/Language. Runs once, lazily, from
    // HostElement — which MeasureOverride pokes the first time this control is
    // measured in the tree, so the editor materialises as soon as it has a slot.
    protected override CreateHostElement(document: Document): HTMLElement
    {
        const el = super.CreateHostElement(document)
        // Monaco fully owns keyboard input while focused, so stop key events at
        // the host boundary. mural's HtmlTarget listens for keydown/keyup on the
        // SVG root and routes them to its focused Visual — but clicking a DomHost
        // never moves mural focus (InjectPointerDown doesn't focus the hit; only a
        // control's own pointer handler does). So mural's focus stays on whatever
        // was last clicked — e.g. the project explorer, a Selector that treats
        // Space as "activate" and pulls focus. Without this, a Space (or any key)
        // typed in the editor bubbles out of the <foreignObject> to that stale
        // focus and yanks it away. Monaco's own handlers sit on its inner textarea
        // (deeper in the tree), so they've already run by the time the event
        // bubbles up to here; stopPropagation only blocks the leak to mural, and
        // we don't preventDefault, so the editor still inserts the character.
        // See DomHost's note: a host that must fully own input stops propagation
        // at its element boundary.
        const swallowKey = (e: Event): void => e.stopPropagation()
        el.addEventListener('keydown', swallowKey)
        el.addEventListener('keyup', swallowKey)
        // Same boundary problem for pointer events: mural's HtmlTarget focuses its
        // SVG host on every pointerdown (handlePointer → host.focus()). Monaco's
        // context menu / overlay widgets render INSIDE this editor's DOM (a shadow
        // root under div.monaco-editor), so pressing a menu item bubbles a
        // pointerdown up to mural, which yanks focus to the SVG host and dismisses
        // the menu before the click lands — every menu item silently no-ops. When a
        // pointer event targets a Monaco popup (menu/context-view/suggest/hover/find
        // overlays — all marked with the shadow-root-host container or these
        // classes), stop it at the boundary so mural never steals focus. The menu
        // lives within the editor's widget, so its own handlers (deeper) still run
        // and widget focus stays with the editor. Normal text-area clicks are left
        // to propagate exactly as before.
        const shieldOverlayPointer = (e: Event): void =>
        {
            const path = e.composedPath() as HTMLElement[]
            if (path.some((n) => n.classList?.contains?.('shadow-root-host')
                || n.classList?.contains?.('monaco-menu') || n.classList?.contains?.('context-view')))
            {
                e.stopPropagation()
            }
        }
        el.addEventListener('pointerdown', shieldOverlayPointer)
        el.addEventListener('pointerup', shieldOverlayPointer)
        // Build Monaco's theme from mural's live tokens BEFORE create so the
        // editor never flashes its default palette. We're in the tree by now
        // (MeasureOverride poked us), so TryFindResource resolves app resources.
        const theme = this.defineMuralTheme()
        // When the document carries a stable URI, create (or reuse) a URI-keyed
        // Monaco model so language-server providers/diagnostics/edits map back to
        // the file. Otherwise fall back to an anonymous model (non-.todl editors).
        const modelUri = this.get_property_value(CodeEditor.ModelUriKey) as string
        const model = modelUri
            ? (monaco.editor.getModel(monaco.Uri.parse(modelUri))
                ?? monaco.editor.createModel(this.Text, this.Language, monaco.Uri.parse(modelUri)))
            : undefined
        this.ownsModel = model !== undefined
        // `semanticHighlighting.enabled: true` turns on the LSP semantic-token
        // overlay (todl concept names → blue). The theme-level flag is ignored by
        // this Monaco version, so it must be forced here; it only affects
        // languages that register a semantic-tokens provider (todl), not .mu.
        const common = { theme, automaticLayout: true, minimap: { enabled: false }, 'semanticHighlighting.enabled': true } as const
        this.editor = monaco.editor.create(el, model
            ? { model, ...common }
            : { value: this.Text, language: this.Language, ...common })
        // Route Monaco's cross-file go-to-definition (into a document not open in
        // a tab) to the host app — bare Monaco can't navigate to an unloaded model.
        this.installCrossFileNavigation()
        // Monaco → DP: push user edits into Text (ignored when WE set the value).
        this.editor.onDidChangeModelContent(() =>
        {
            if (this.updating) return
            this.updating = true
            this.Text = this.editor?.getValue() ?? ''
            this.updating = false
        })
        // Catch up on diagnostics bound before the editor existed (the binding may
        // resolve before mount), and reflect any already-present ones.
        this.bindDiagnostics(this.Diagnostics)
        // Replay a reveal that arrived before mount (dock navigation / "Go to
        // Definition" opens a tab then reveals; the editor and its content may not
        // exist yet on first open). Retry on layout too, so a reveal buffered while
        // the editor was still zero-height lands once Monaco sizes it.
        this.applyPendingReveal()
        this.revealLayoutSub = this.editor.onDidLayoutChange(() => this.applyPendingReveal())
        return el
    }

    // Monaco resolves go-to-definition/references navigation through a shared
    // ICodeEditorService.openCodeEditor, which in the bare standalone setup only
    // handles targets already loaded as models. Register an open-handler (public
    // API; ours runs first via unshift) that, when the target differs from the
    // initiating editor's model, hands the URI to the host to open in a tab +
    // reveal. Returning null lets Monaco's default handle same-file navigation
    // in place; installed once — the service is a standalone singleton.
    private static crossFileInstalled = false
    private installCrossFileNavigation(): void
    {
        if (CodeEditor.crossFileInstalled) return
        const svc = (this.editor as unknown as {
            _codeEditorService?: {
                registerCodeEditorOpenHandler?: (
                    h: (
                        input: { resource?: { toString(): string }; options?: { selection?: CrossFileSelection } },
                        source?: { getModel(): { uri: { toString(): string } } | null } | null,
                    ) => Promise<unknown>,
                ) => unknown
            }
        })._codeEditorService
        if (svc?.registerCodeEditorOpenHandler === undefined) return
        CodeEditor.crossFileInstalled = true
        svc.registerCodeEditorOpenHandler(async (input, source) => {
            const target = input.resource?.toString()
            const current = source?.getModel()?.uri.toString()
            if (target !== undefined && target !== current) handleCrossFileOpen(target, input.options?.selection)
            return null
        })
    }

    // (Re)subscribe to a bound Diagnostics collection and render it. The document
    // mutates one collection instance in place (Clear/Add), so we listen to the
    // collection's changes; applyMarkers no-ops until the editor exists.
    private bindDiagnostics(collection: ObservableCollection<EditorDiagnostic> | undefined): void
    {
        this.diagUnsub?.()
        // New binding target ⇒ force the next apply (don't skip on a stale sig).
        this.lastMarkerSig = undefined
        this.diagUnsub = collection?.Subscribe(() => this.scheduleMarkers())
        this.scheduleMarkers()
    }

    // Debounce marker application: a burst of Clear/Add mutations (or repeated
    // rescans) collapses to one apply ~60ms later. Leading-window coalescing —
    // the first change arms the timer; changes within the window are absorbed and
    // picked up when it fires, so continuous validation can't starve the update.
    private scheduleMarkers(): void
    {
        if (this.markerTimer !== undefined) return
        this.markerTimer = setTimeout(() =>
        {
            this.markerTimer = undefined
            this.applyMarkers()
        }, 60)
    }

    private applyMarkers(): void
    {
        const model = this.editor?.getModel()
        if (model === null || model === undefined) return
        const diags = this.Diagnostics?.ToArray() ?? []
        // Skip the decoration re-render when the set is byte-for-byte unchanged.
        const sig = markerSignature(diags)
        if (sig === this.lastMarkerSig) return
        this.lastMarkerSig = sig
        monaco.editor.setModelMarkers(model, MARKER_OWNER, toMarkers(diags))
    }

    // A reveal requested before the editor mounted, replayed once it exists.
    private pendingReveal: { line: number; column: number } | undefined
    // Kept for the editor's lifetime: retries a buffered reveal on each layout, so
    // a reveal requested before Monaco was sized still lands. Disposed with the editor.
    private revealLayoutSub: monaco.IDisposable | undefined

    // Record a reveal request (line/column, 1-based) and try to satisfy it. A
    // reveal issued during the initial open arrives BEFORE the content and layout
    // are in place: Monaco's model still holds the placeholder single line (so a
    // jump to line N clamps to line 1) and the editor may not be sized yet. So the
    // request is buffered and re-applied by applyPendingReveal when the content
    // loads (setValue) and on layout — guarded on model line count so it only
    // fires once the target line actually exists.
    private revealSpan(line: number, column: number): void
    {
        this.pendingReveal = { line, column }
        this.applyPendingReveal()
    }

    // Apply the buffered reveal if the editor is mounted, sized, and its model has
    // grown to include the target line; otherwise leave it buffered for a later
    // retry (content load / layout). Immediate (non-animated) scroll so the jump
    // lands deterministically instead of racing an in-flight smooth scroll.
    private applyPendingReveal(): void
    {
        const ed = this.editor
        const req = this.pendingReveal
        if (ed === undefined || req === undefined) return
        const model = ed.getModel()
        if (model === null) return
        if (ed.getLayoutInfo().height <= 0) return          // not laid out yet
        if (req.line > model.getLineCount()) return          // content not loaded to this line yet
        this.pendingReveal = undefined
        const range = new monaco.Range(req.line, req.column, req.line, req.column)
        ed.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate)
        ed.setSelection(range)
        ed.focus()
    }

    // Self-materialise: touching HostElement the first time we're measured in
    // the tree runs CreateHostElement, so no external code has to poke us to
    // mount. (Base DomHost stays lazy — an empty host has nothing to show.)
    protected override MeasureOverride(available: Size): Size
    {
        void this.HostElement
        return super.MeasureOverride(available)
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        // Rebind diagnostics even before the editor mounts (subscription is cheap;
        // applyMarkers no-ops until there's a model to mark).
        if (descriptor.Name === 'Diagnostics')
        {
            this.bindDiagnostics(newValue as ObservableCollection<EditorDiagnostic> | undefined)
            return
        }
        if (descriptor.Name === 'RevealRequest')
        {
            const req = newValue as { line: number; column: number } | undefined
            if (req !== undefined) this.revealSpan(req.line, req.column)
            return
        }
        if (this.editor === undefined) return
        // DP → Monaco: reflect an external Text change (initial load, a
        // programmatic set) into the buffer, unless Monaco itself was the origin.
        if (descriptor.Name === 'Text' && !this.updating)
        {
            const next = newValue as string
            if (this.editor.getValue() !== next)
            {
                this.updating = true
                this.editor.setValue(next)
                this.updating = false
                // Content just grew — a reveal buffered before the content loaded
                // (open-then-reveal) can now land on its target line.
                this.applyPendingReveal()
            }
        }
        else if (descriptor.Name === 'Language')
        {
            const model = this.editor.getModel()
            if (model !== null) monaco.editor.setModelLanguage(model, newValue as string)
        }
    }

    public dispose(): void
    {
        this.diagUnsub?.()
        this.diagUnsub = undefined
        this.revealLayoutSub?.dispose()
        this.revealLayoutSub = undefined
        if (this.markerTimer !== undefined) { clearTimeout(this.markerTimer); this.markerTimer = undefined }
        const model = this.ownsModel ? this.editor?.getModel() : undefined
        this.editor?.dispose()
        model?.dispose()
        this.editor = undefined
    }

    // Resolve a mural color token (@Surface, @OnSurface, …) off this control's
    // resource scope. Returns the token's Color, or undefined if unresolved /
    // not a solid brush (the theme then falls back to the Monaco base).
    private themeColor(token: string): Color | undefined
    {
        const brush = this.TryFindResource(token)
        return brush instanceof SolidColorBrush ? brush.Color : undefined
    }

    // Define the 'mural' Monaco theme from the resolved surface tokens — chrome
    // only (background, gutter, line numbers, cursor, selection, line highlight,
    // widget borders); syntax token colors stay the Monaco base's, which is
    // tuned for legibility. Base (vs / vs-dark) is chosen from Surface luminance
    // so a light or dark mural scheme both read correctly. Resolved once at
    // mount — a runtime theme switch won't live-update the editor.
    private defineMuralTheme(): string
    {
        const surface        = this.themeColor('Surface')
        const onSurface      = this.themeColor('OnSurface')
        const onSurfaceVar   = this.themeColor('OnSurfaceVariant')
        const primary        = this.themeColor('Primary')
        const outlineVariant = this.themeColor('OutlineVariant')
        const container      = this.themeColor('SurfaceContainer')
        const containerHigh  = this.themeColor('SurfaceContainerHighest')

        const colors: Record<string, string> = {}
        const set = (key: string, c: Color | undefined): void => { if (c !== undefined) colors[key] = c.ToHex() }
        set('editor.background',                surface)
        set('editor.foreground',                onSurface)
        set('editorGutter.background',          surface)
        set('editorLineNumber.foreground',      onSurfaceVar)
        set('editorLineNumber.activeForeground', onSurface)
        set('editorCursor.foreground',          primary)
        // Selection is a translucent Primary wash so the text under it stays readable.
        if (primary !== undefined) colors['editor.selectionBackground'] = primary.WithAlpha(0x4d).ToHex()
        set('editor.lineHighlightBackground',   containerHigh)
        set('editorIndentGuide.background',     outlineVariant)
        set('editorWidget.background',          container)
        set('editorWidget.border',              outlineVariant)
        set('editorHoverWidget.background',     container)
        set('editorHoverWidget.border',         outlineVariant)

        // Relative luminance (Rec. 601) of Surface decides light vs dark base.
        const dark = surface === undefined
            || (0.299 * surface.R + 0.587 * surface.G + 0.114 * surface.B) < 128
        // Semantic highlighting only affects files with a semantic-tokens
        // provider (todl); the rules name TODL-only scopes (todlType/todlClass),
        // so .mu files are untouched. Concept names thus render the keyword blue.
        // `semanticHighlighting` is honored by Monaco's runtime theme service but
        // is missing from the bundled IStandaloneThemeData typings — cast rather
        // than drop it.
        monaco.editor.defineTheme(MURAL_THEME, {
            base:    dark ? 'vs-dark' : 'vs',
            inherit: true,
            rules:   todlSemanticThemeRules(dark),
            colors,
            semanticHighlighting: true,
        } as monaco.editor.IStandaloneThemeData)
        return MURAL_THEME
    }
}
