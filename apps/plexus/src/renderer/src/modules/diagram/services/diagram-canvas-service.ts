import {
    Application, Color, ServiceBase, ServiceKey, ThemeManager, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    ApplicationSettings, ContentHostService, DiagramDocument, Setting,
    type DocumentsContentHostService, type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import { PaginatedCanvas } from '@pragmatic-tech-ai/mural/basic'
import { PatternBrush, PatternKind, SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'

const SHOW_KEY   = 'diagram.grid.show'
const SIZE_KEY   = 'diagram.grid.size'
const WIDTH_KEY  = 'diagram.page.width'
const HEIGHT_KEY = 'diagram.page.height'
const DEFAULT_SIZE   = 20
const DEFAULT_WIDTH  = 2000
const DEFAULT_HEIGHT = 2000
// The diagram page background is the theme's @DiagramCanvas token (light
// #FDFDFD / dark #2A2A2E). The grid lines are that colour shifted 10% toward
// CONTRAST — lighter on a dark page, darker on a light one — so the grid stays
// a subtle-but-visible tint of the paper in every theme (a strict "lighten"
// would vanish on a near-white light page).
const CANVAS_TOKEN   = 'DiagramCanvas'
const CANVAS_FALLBACK = '#FDFDFD'
const GRID_STEP      = 0.1

// App-scoped observer that drives the diagram canvas background from settings.
// For every open DiagramDocument it grabs the live Diagram's PaginatedCanvas
// (its ItemsPanel) and applies two things:
//   * Page size — PageWidth / PageHeight from the page settings.
//   * Grid — when "Show grid" is on, sets PaperBrush to a grid PatternBrush
//     whose background is the theme page colour (@DiagramCanvas) and whose
//     lines are that colour lightened 10% — so the grid is a subtle,
//     theme-adaptive tint of the paper, with no user-set colour. When off, it
//     CLEARS the PaperBrush so the template's @DiagramCanvas dynamic-resource
//     paper re-applies.
//
// Reactive on three axes: a settings change (show / size / page size) and a
// theme (light/dark) swap both re-apply to every live canvas, and a document
// (re)publishing its ActiveView re-grabs the canvas and applies. Mirrors
// DiagramCameraService's open-docs + ActiveView attach pattern.
export class DiagramCanvasService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DiagramCanvasService>('DiagramCanvasService')

    private readonly bindings = new Map<IDocument, () => void>()   // doc → detach
    private readonly canvases = new Set<PaginatedCanvas>()          // live canvases to apply to

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        host?.OpenDocuments.Subscribe(() => this.sync(host))
        this.watchSettings()
        // The grid colour is derived from the theme's page background, so a
        // light/dark scheme swap must repaint every live canvas.
        ThemeManager.AddActivatedListener(() => this.reapplyAll())
    }

    private reapplyAll(): void
    {
        for (const c of this.canvases) this.applyTo(c)
    }

    private sync(host: DocumentsContentHostService): void
    {
        const current = new Set(host.OpenDocuments.ToArray())
        for (const [doc, detach] of [...this.bindings]) {
            if (!current.has(doc)) { detach(); this.bindings.delete(doc) }
        }
        for (const doc of current) this.attach(doc)
    }

    // Idempotent per document. Subscribes to ActiveView (re)publication; on each,
    // (re)grabs the live PaginatedCanvas and applies the current settings.
    private attach(doc: IDocument): void
    {
        if (this.bindings.has(doc) || !(doc instanceof DiagramDocument)) return

        let canvas: PaginatedCanvas | undefined

        const rebindView = (): void => {
            if (canvas !== undefined) { this.canvases.delete(canvas); canvas = undefined }
            const view = doc.ActiveView
            if (view === undefined) return
            const panel = view.ItemsPanelInstance
            if (!(panel instanceof PaginatedCanvas)) return
            canvas = panel
            this.canvases.add(canvas)
            this.applyTo(canvas)
        }

        const subActiveView = doc.PropertyChanged(DiagramDocument.ActiveViewKey).subscribe(rebindView)
        rebindView()

        this.bindings.set(doc, () => {
            if (canvas !== undefined) this.canvases.delete(canvas)
            subActiveView.dispose()
        })
    }

    // Attach change listeners to the canvas settings; any change re-applies to
    // every live canvas. No-op headless / before settings are wired.
    private watchSettings(): void
    {
        const settings = this.settings()
        if (settings === undefined) return
        const reapply = (): void => this.reapplyAll()
        for (const key of [SHOW_KEY, SIZE_KEY, WIDTH_KEY, HEIGHT_KEY]) {
            settings.GetSetting(key)?.PropertyChanged(Setting.ValueKey).subscribe(reapply)
        }
    }

    private settings(): ApplicationSettings | undefined
    {
        return Application.current?.Services.get(ApplicationSettings.Key)
    }

    // Apply page size + grid to one canvas from the current setting values.
    private applyTo(canvas: PaginatedCanvas): void
    {
        const settings = this.settings()
        if (settings === undefined) return

        // Page size.
        const widthVal  = settings.Get(WIDTH_KEY)
        const heightVal = settings.Get(HEIGHT_KEY)
        canvas.PageWidth  = typeof widthVal  === 'number' && widthVal  > 0 ? widthVal  : DEFAULT_WIDTH
        canvas.PageHeight = typeof heightVal === 'number' && heightVal > 0 ? heightVal : DEFAULT_HEIGHT

        // Grid. Off → drop the local PaperBrush so the template's @DiagramCanvas
        // dynamic-resource paper re-applies (theme-adaptive again).
        if (settings.Get(SHOW_KEY) === false) {
            canvas.ClearValue(PaginatedCanvas.PaperBrushKey)
            return
        }

        const sizeVal = settings.Get(SIZE_KEY)
        const size    = typeof sizeVal === 'number' && sizeVal > 0 ? sizeVal : DEFAULT_SIZE

        // Grid colour = the theme page background, shifted 10% toward contrast
        // (lighter on a dark page, darker on a light one). The pattern's
        // background is that same page colour, so the page keeps its theme paper
        // and the grid reads as a subtle tint of it.
        const bg   = this.pageBackground()
        const line = Color.Lerp(bg, isDark(bg) ? Color.White : Color.Black, GRID_STEP)

        const brush = new PatternBrush(PatternKind.Grid, line)
        brush.Background      = bg
        brush.Size            = size
        brush.StrokeThickness = 1
        canvas.PaperBrush = brush
    }

    // The diagram page background colour from the active theme (@DiagramCanvas),
    // or a light-paper fallback before the theme is registered.
    private pageBackground(): Color
    {
        const res = Application.current?.Resources.Resolve(CANVAS_TOKEN)
        return res instanceof SolidColorBrush ? res.Color : Color.FromHex(CANVAS_FALLBACK)
    }
}

// Perceived-luminance test (Rec. 601 weights, 0..1). Below the midpoint the
// paper is dark, so the grid shifts toward white; at/above it toward black.
function isDark(c: Color): boolean
{
    return (0.299 * c.R + 0.587 * c.G + 0.114 * c.B) / 255 < 0.5
}

export default DiagramCanvasService
