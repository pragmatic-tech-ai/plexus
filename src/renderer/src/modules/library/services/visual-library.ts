import { instantiate, DEFAULT_SYMBOLS } from '@pragmatic-tech-ai/mural/compiler'
import * as muralRuntime from '@pragmatic-tech-ai/mural/runtime'
import * as muralBasic from '@pragmatic-tech-ai/mural/basic'
import * as muralEngine from '@pragmatic-tech-ai/mural/visual-engine'
import { DataTemplate, type DataTemplateFactory } from '@pragmatic-tech-ai/mural/basic'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'
import { IconKeyConverter, ImageKeyConverter } from '../../diagram/services/icon-key-converter.js'

// Compiler symbol table extended with the fragment-referenced converters so
// `$IconKey << IconKeyConverter` / `<< ImageKeyConverter` resolve (the module string
// is unused by instantiate — the value comes from ctx — but must be present so
// ensureImport does not reject the symbol).
const CONVERTER_MODULE = '../../diagram/services/icon-key-converter.js'
const SYMBOLS = new Map([
    ...DEFAULT_SYMBOLS,
    ['IconKeyConverter', CONVERTER_MODULE],
    ['ImageKeyConverter', CONVERTER_MODULE],
])

// The runtime symbol table instantiate() destructures the fragment's referenced
// symbols from. Built once per registry. A no-arg converter reference
// (`$IconKey << IconKeyConverter`) resolves to the bare symbol and the binding
// calls `.convert` on it, so ctx must map the name to a converter INSTANCE.
export function buildCtx(): Record<string, unknown>
{
    return {
        ...muralRuntime, ...muralBasic, ...muralEngine,
        IconKeyConverter: new IconKeyConverter(),
        ImageKeyConverter: new ImageKeyConverter(),
    }
}

// Compile a `.mural` fragment (a bare-element root) into a DataTemplate. instantiate
// returns a zero-arg factory that builds the fragment's visual; we wrap it so the
// host's Content becomes the visual's DataContext (bindings like $Display resolve
// against it). Throws (via instantiate) if the source can't compile.
export function compileTemplate(source: string, ctx: Record<string, unknown>): DataTemplate
{
    const factory = instantiate(source, ctx, { symbols: SYMBOLS }) as () => Visual
    const wrapped: DataTemplateFactory = (data) => {
        const v = factory() as Visual & { DataContext: unknown }
        v.DataContext = data
        return v
    }
    return new DataTemplate(wrapped)
}

// The default visual body every published-package entity renders through: draws the
// entity's icon from the bound $IconKey two ways, overlaid in a Grid — an Image for a
// RASTER icon (ImageKeyConverter → BitmapImage) and an Icon for a VECTOR icon
// (IconKeyConverter → colored IconDefinition, empty/unknown key → the default glyph).
// Exactly one is non-empty per entity — each converter yields undefined for the other's
// asset kind — so they never collide. Recolor=false keeps each icon's own fills;
// Foreground themes any currentColor shapes; Stretch=Uniform preserves a bitmap's
// aspect. The templates now bind against an EntityIconVM, so $IconKey resolves off it.
// The icon STRETCHES to fill its Grid cell (no explicit width/height): the outer
// ContentControl is sized per context in the (P3) markup, and the icon fills it.
// It carries NO label: the host (tile / canvas node / preview) draws the caption.
const ICON_BODY =
      ' Grid {'
    + ' Image [ Source = $IconKey << ImageKeyConverter, Stretch = Uniform,'
    + ' HorizontalAlignment = Stretch, VerticalAlignment = Stretch ]'
    + ' Icon [ Source = $IconKey << IconKeyConverter, Recolor = false, Foreground = @OnSurface,'
    + ' HorizontalAlignment = Stretch, VerticalAlignment = Stretch ]'
    + ' }'

// Tile context (toolbox tiles + library preview): a raised @SurfaceContainerHigh chip
// behind the icon. The enclosing tile/preview draws its own outer chrome around this.
// The ROOT is NOT hit-test visible — a tile is drag chrome: the enclosing Border owns
// the gesture, so the rendered visual must not swallow hit-testing (preserves the old
// TodlVisualResolver's `visual.IsHitTestVisible = false` for the Tile context).
const TILE_SOURCE = 'Border [ Fill = @SurfaceContainerHigh, CornerRadius = 6, IsHitTestVisible = false ] {' + ICON_BODY + ' }'

// Figure context (canvas nodes): NO background — the icon floats transparently on the
// diagram; the canvas node draws no chip behind it.
const FIGURE_SOURCE = 'Border [ CornerRadius = 6 ] {' + ICON_BODY + ' }'

export function buildDefaultTemplate(ctx: Record<string, unknown>): DataTemplate
{
    return compileTemplate(TILE_SOURCE, ctx)
}

// The transparent-background variant for canvas figures.
export function buildFigureTemplate(ctx: Record<string, unknown>): DataTemplate
{
    return compileTemplate(FIGURE_SOURCE, ctx)
}
