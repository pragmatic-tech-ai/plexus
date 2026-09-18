import {
    MuralBase, MetaData, ObservableCollection, ServiceBase, ServiceKey, RelayCommand,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import { ViewportService } from '../../services/viewport/viewport-service.js'
import { ClipboardService } from '../../services/clipboard/clipboard-service.js'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer'

// The Problems popup caps its scrollable list at this fraction of the live
// window height. When no ViewportService is available (headless edge cases), fall
// back to a fixed height so the list still scrolls rather than growing unbounded.
const LIST_HEIGHT_FRACTION = 0.3
const FALLBACK_LIST_MAX_HEIGHT = 240

// A standalone ServiceKey (like the framework's DiagramEditingContext). The
// StatusBar ShellControlDefinition references THIS as its DataContext: the shell
// resolves it via provider.get(def.DataContext) with no class→Key normalization,
// so it must be handed the ServiceKey instance, not the ProblemsService class.
export const ProblemsServiceKey = new ServiceKey<ProblemsService>('ProblemsService')

// The row kinds the dock renders: an optional project header (only when several
// projects have problems), then one self-contained Diagnostic row per problem.
export enum ProblemRowKind { ProjectHeader, Diagnostic }

// One row in the dock. A MuralBase so the .mu template binds $Label / $Detail / etc.
export class ProblemsRow extends MuralBase
{
    public static readonly KindKey = MuralBase.RegisterProperty<ProblemRowKind>(
        ProblemsRow, 'Kind', ProblemRowKind.Diagnostic, MetaData.None)
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(ProblemsRow, 'Label', '', MetaData.None)
    public static readonly DetailKey = MuralBase.RegisterProperty<string>(ProblemsRow, 'Detail', '', MetaData.None)
    public static readonly SeverityKey = MuralBase.RegisterProperty<DiagnosticSeverity>(
        ProblemsRow, 'Severity', DiagnosticSeverity.Error, MetaData.None)
    public static readonly IsErrorKey = MuralBase.RegisterProperty<boolean>(ProblemsRow, 'IsError', false, MetaData.None)
    public static readonly IsDiagnosticKey = MuralBase.RegisterProperty<boolean>(ProblemsRow, 'IsDiagnostic', false, MetaData.None)
    public static readonly ProjectIdKey = MuralBase.RegisterProperty<string>(ProblemsRow, 'ProjectId', '', MetaData.None)
    public static readonly UriKey = MuralBase.RegisterProperty<string | null>(ProblemsRow, 'Uri', null, MetaData.None)
    public static readonly LineKey = MuralBase.RegisterProperty<number>(ProblemsRow, 'Line', 1, MetaData.None)
    public static readonly ColumnKey = MuralBase.RegisterProperty<number>(ProblemsRow, 'Column', 1, MetaData.None)
    public static readonly ActivateCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProblemsRow, 'ActivateCommand', undefined, MetaData.None)
    public static readonly CopyCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProblemsRow, 'CopyCommand', undefined, MetaData.None)

    constructor(init: {
        kind: ProblemRowKind; label: string; detail?: string; severity?: DiagnosticSeverity;
        projectId?: string; uri?: string | null; line?: number; column?: number
    })
    {
        super()
        const severity = init.severity ?? DiagnosticSeverity.Error
        this.set_property_value(ProblemsRow.KindKey, init.kind)
        this.set_property_value(ProblemsRow.LabelKey, init.label)
        this.set_property_value(ProblemsRow.DetailKey, init.detail ?? '')
        this.set_property_value(ProblemsRow.SeverityKey, severity)
        this.set_property_value(ProblemsRow.IsErrorKey, severity === DiagnosticSeverity.Error)
        this.set_property_value(ProblemsRow.IsDiagnosticKey, init.kind === ProblemRowKind.Diagnostic)
        this.set_property_value(ProblemsRow.ProjectIdKey, init.projectId ?? '')
        this.set_property_value(ProblemsRow.UriKey, init.uri ?? null)
        this.set_property_value(ProblemsRow.LineKey, init.line ?? 1)
        this.set_property_value(ProblemsRow.ColumnKey, init.column ?? 1)
    }

    public get Kind(): ProblemRowKind { return this.get_property_value(ProblemsRow.KindKey) }
    public get Label(): string { return this.get_property_value(ProblemsRow.LabelKey) }
    public get Detail(): string { return this.get_property_value(ProblemsRow.DetailKey) }
    public get ProjectId(): string { return this.get_property_value(ProblemsRow.ProjectIdKey) }
    public get Uri(): string | null { return this.get_property_value(ProblemsRow.UriKey) }
    public get Line(): number { return this.get_property_value(ProblemsRow.LineKey) }
    public get Column(): number { return this.get_property_value(ProblemsRow.ColumnKey) }
    public get ActivateCommand(): ICommand | undefined { return this.get_property_value(ProblemsRow.ActivateCommandKey) }
    public set ActivateCommand(v: ICommand | undefined) { this.set_property_value(ProblemsRow.ActivateCommandKey, v) }
    public get CopyCommand(): ICommand | undefined { return this.get_property_value(ProblemsRow.CopyCommandKey) }
    public set CopyCommand(v: ICommand | undefined) { this.set_property_value(ProblemsRow.CopyCommandKey, v) }
}

// A grouped, observable view over the DiagnosticsService, rendered in the shell's
// Status region as the Problems dock. Rebuilds its flat Rows whenever the store
// changes; exposes rolled-up counts, an expand toggle, and row activation
// (open file + reveal the span through the project explorer).
//
// The Key is the standalone ProblemsServiceKey (below the imports) — the .mu
// StatusBar control references THAT ServiceKey as its DataContext, because the
// shell resolves it via provider.get(token) with no class→Key normalization.
export class ProblemsService extends ServiceBase
{
    public static readonly Key = ProblemsServiceKey

    private readonly _rows = new ObservableCollection<ProblemsRow>()
    private _errorCount = 0
    private _warningCount = 0
    // The status-bar cell's face text (e.g. "3 errors, 2 warnings" / "No problems").
    private _summaryText = 'No problems'
    // Drives the MenuButton popup open (bound one-way IsOpen = $IsOpen): a failed
    // publish sets it true via Expand() to surface the problems.
    private _isOpen = false

    // Toolbar filter state. Any change re-runs rebuild() (see the setters below),
    // which filters the diagnostics before grouping. Counts stay full totals.
    private _showErrors = true
    private _showWarnings = true
    private _filterText = ''

    // MaxHeight for the popup's scrollable list = 30% of the live window height.
    // Bound by the .mu ScrollViewer; recomputed whenever ViewportService.Height
    // changes.
    private _listMaxHeight = FALLBACK_LIST_MAX_HEIGHT

    // Popup width = the live window width, so the dropdown spans the whole window.
    // Bound by the .mu popup container; recomputed on resize.
    private _popupWidth = 0

    // Toolbar commands: copy the (filtered) list to the clipboard; reset filters.
    private readonly _copyAllCommand: ICommand
    private readonly _clearFiltersCommand: ICommand

    // Set true while ClearFilters mutates several filter properties, so their
    // individual property-change notifications don't each trigger a rebuild
    // (ClearFilters rebuilds once at the end).
    private suppressRebuild = false

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const store = provider.get(DiagnosticsService.Key)
        // Subscribe to the store's coalesced change signal (once per Publish), NOT
        // to All's per-item collection events — the latter fires N+1 times per
        // publish and made this O(N) rebuild run per-item (O(N^2), froze the app).
        store?.Subscribe(() => this.rebuild())
        const viewport = provider.get(ViewportService.Key)
        if (viewport !== undefined) {
            const sync = (): void => {
                this.updateListMaxHeight(viewport.Height)
                this.setPopupWidth(viewport.Width)
            }
            sync()
            viewport.Subscribe(sync)
        }
        this._copyAllCommand = new RelayCommand(() => void this.copyAll())
        this._clearFiltersCommand = new RelayCommand(() => this.clearFilters())
        this.rebuild()
    }

    public get Rows(): ObservableCollection<ProblemsRow> { return this._rows }
    public get ErrorCount(): number { return this._errorCount }
    private setErrorCount(v: number): void { const o = this._errorCount; if (o === v) return; this._errorCount = v; this.RaisePropertyChanged('ErrorCount', o, v) }
    public get WarningCount(): number { return this._warningCount }
    private setWarningCount(v: number): void { const o = this._warningCount; if (o === v) return; this._warningCount = v; this.RaisePropertyChanged('WarningCount', o, v) }
    public get SummaryText(): string { return this._summaryText }
    private setSummaryText(v: string): void { const o = this._summaryText; if (o === v) return; this._summaryText = v; this.RaisePropertyChanged('SummaryText', o, v) }
    public get IsOpen(): boolean { return this._isOpen }
    public set IsOpen(v: boolean) { const o = this._isOpen; if (o === v) return; this._isOpen = v; this.RaisePropertyChanged('IsOpen', o, v) }
    public get ShowErrors(): boolean { return this._showErrors }
    public set ShowErrors(v: boolean) { const o = this._showErrors; if (o === v) return; this._showErrors = v; this.RaisePropertyChanged('ShowErrors', o, v); this.onFilterChanged() }
    public get ShowWarnings(): boolean { return this._showWarnings }
    public set ShowWarnings(v: boolean) { const o = this._showWarnings; if (o === v) return; this._showWarnings = v; this.RaisePropertyChanged('ShowWarnings', o, v); this.onFilterChanged() }
    public get FilterText(): string { return this._filterText }
    public set FilterText(v: string) { const o = this._filterText; if (o === v) return; this._filterText = v; this.RaisePropertyChanged('FilterText', o, v); this.onFilterChanged() }
    public get ListMaxHeight(): number { return this._listMaxHeight }
    private setListMaxHeight(v: number): void { const o = this._listMaxHeight; if (o === v) return; this._listMaxHeight = v; this.RaisePropertyChanged('ListMaxHeight', o, v) }
    public get PopupWidth(): number { return this._popupWidth }
    private setPopupWidth(v: number): void { const o = this._popupWidth; if (o === v) return; this._popupWidth = v; this.RaisePropertyChanged('PopupWidth', o, v) }
    public get CopyAllCommand(): ICommand | undefined { return this._copyAllCommand }
    public get ClearFiltersCommand(): ICommand | undefined { return this._clearFiltersCommand }

    // A filter property changed: re-run rebuild() unless we're in the middle of a
    // ClearFilters batch (which rebuilds once at the end).
    private onFilterChanged(): void
    {
        if (this.suppressRebuild) return
        this.rebuild()
    }

    public Expand(): void { this.IsOpen = true }

    // Open the row's file and scroll to its span (project-level rows do nothing),
    // then close the popup.
    public ActivateRow(row: ProblemsRow): void
    {
        if (row.Uri === null) return
        void this.Provider.get(ProjectExplorerService.Key)?.OpenFileInProject(row.ProjectId, row.Uri, row.Line, row.Column)
        this.IsOpen = false
    }

    private rebuild(): void
    {
        const store = this.Provider.get(DiagnosticsService.Key)
        const all: Diagnostic[] = store ? [...store.All] : []

        let errors = 0, warnings = 0
        for (const d of all) {
            if (d.severity === DiagnosticSeverity.Error) errors += 1
            else if (d.severity === DiagnosticSeverity.Warning) warnings += 1
        }
        this.setErrorCount(errors)
        this.setWarningCount(warnings)
        this.setSummaryText(summarize(errors, warnings))

        // Group by project (first-seen order) only to insert a project header when
        // more than one project has problems. Within a project, each diagnostic is
        // ONE self-contained row: the message plus its file + location — no separate
        // file-header rows (which read as disconnected siblings in a flat popup).
        const visible = all.filter((d) => this.matchesFilter(d))

        const byProject = new Map<string, { name: string; diags: Diagnostic[] }>()
        for (const d of visible) {
            let proj = byProject.get(d.projectId)
            if (proj === undefined) { proj = { name: d.projectName, diags: [] }; byProject.set(d.projectId, proj) }
            proj.diags.push(d)
        }

        const rows = this.Rows
        rows.Clear()
        const multiProject = byProject.size > 1
        for (const [projectId, proj] of byProject) {
            if (multiProject) rows.Add(new ProblemsRow({ kind: ProblemRowKind.ProjectHeader, label: proj.name }))
            for (const d of proj.diags) {
                const row = new ProblemsRow({
                    kind: ProblemRowKind.Diagnostic,
                    label: d.message,
                    detail: locationLabel(d),
                    severity: d.severity,
                    projectId,
                    uri: d.uri,
                    line: d.span?.startLine ?? 1,
                    column: d.span?.startColumn ?? 1,
                })
                row.ActivateCommand = new RelayCommand(() => this.ActivateRow(row))
                row.CopyCommand = new RelayCommand(() => void this.copyOne(d))
                rows.Add(row)
            }
        }
    }

    // Filter predicate applied before grouping: severity toggles gate errors and
    // warnings (other severities always shown); a non-empty FilterText must appear
    // (case-insensitively) in the message or the file name.
    private matchesFilter(d: Diagnostic): boolean
    {
        if (d.severity === DiagnosticSeverity.Error && !this.ShowErrors) return false
        if (d.severity === DiagnosticSeverity.Warning && !this.ShowWarnings) return false
        const q = this.FilterText.trim().toLowerCase()
        if (q === '') return true
        const file = d.uri === null ? '' : fileNameOf(d.uri)
        return d.message.toLowerCase().includes(q) || file.toLowerCase().includes(q)
    }

    private updateListMaxHeight(height: number): void
    {
        const h = height > 0 ? Math.round(height * LIST_HEIGHT_FRACTION) : FALLBACK_LIST_MAX_HEIGHT
        this.setListMaxHeight(h)
    }

    // Copy every currently displayed (filtered) diagnostic as text — WYSIWYG with
    // the visible list. Re-derives the filtered set from the store so it reflects
    // the current toggles/text.
    private async copyAll(): Promise<void>
    {
        const store = this.Provider.get(DiagnosticsService.Key)
        const all: Diagnostic[] = store ? [...store.All] : []
        const text = all.filter((d) => this.matchesFilter(d)).map(problemLine).join('\n')
        await this.Provider.get(ClipboardService.Key)?.writeText(text)
    }

    private async copyOne(d: Diagnostic): Promise<void>
    {
        await this.Provider.get(ClipboardService.Key)?.writeText(problemLine(d))
    }

    // Reset all filters and rebuild once (suppressRebuild coalesces the three DP
    // changes into a single rebuild at the end).
    private clearFilters(): void
    {
        this.suppressRebuild = true
        this.FilterText = ''
        this.ShowErrors = true
        this.ShowWarnings = true
        this.suppressRebuild = false
        this.rebuild()
    }
}

// The "where" for a diagnostic row: "file.todl 3:5", "file.todl", or "" (a
// project-level problem like an unresolved base binding has no file/line).
function locationLabel(d: Diagnostic): string
{
    const file = d.uri === null ? '' : fileNameOf(d.uri)
    const loc = d.span ? `${d.span.startLine}:${d.span.startColumn}` : ''
    return [file, loc].filter(Boolean).join(' ')
}

function fileNameOf(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// The status-bar cell's face text — a glanceable count, or "No problems" when clean.
function summarize(errors: number, warnings: number): string
{
    if (errors === 0 && warnings === 0) return 'No problems'
    const parts: string[] = []
    if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`)
    if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
    return parts.join(', ')
}

const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
    [DiagnosticSeverity.Error]:   'ERROR',
    [DiagnosticSeverity.Warning]: 'WARNING',
    [DiagnosticSeverity.Info]:    'INFO',
    [DiagnosticSeverity.Hint]:    'HINT',
}

// One clipboard line for a diagnostic: "<SEVERITY>  <file line:col>  <message>".
// The location segment collapses out for a project-level (null-uri) diagnostic.
function problemLine(d: Diagnostic): string
{
    return [SEVERITY_LABEL[d.severity], locationLabel(d), d.message].filter(Boolean).join('  ')
}
