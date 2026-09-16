import { test, expect, afterEach } from 'vitest'
import { Application, ServiceKey, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { DataTemplate, Image, Icon, TextBlock, TextWrapping } from '@pragmatic-tech-ai/mural/basic'
import { setIconResourceResolver } from '../icon-key-converter.js'
import {
    ContentControl, ShapeToolboxItem, ToolboxItem, ToolboxVisualPresenter, ToolboxVisualDescriptor,
    VisualContext, VisualContextScope, type IToolboxDropFactory,
} from '@pragmatic-tech-ai/mural/framework'

import { DiagramResources } from '../../diagram.resources.mu.js'
import { TodlVisualSelector } from '../todl-visual-selector.js'
import { ArchToolboxItem, ArchToolboxVisualKey } from '../arch-toolbox-item.js'
import { EntityIconVM } from '../entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'

// View-level regression for the toolbox tile. Two type-keyed templates share the
// same draggable chrome + caption but differ in the picture:
//   * base [DataType=ToolboxItem]      → mural ShapeToolboxItems render their shape
//     FIGURE via ToolboxVisualPresenter (shapes have no EntityIconVM).
//   * [DataType=ArchToolboxItem]       → library/meta-model terms render their class
//     ICON via a ContentControl + @TodlVisualSelector (Tile context), bound to $Icon.
// This guards the regression where the shared template bound $Icon and blanked shapes.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    app.Resources.AddMergedDictionary(DiagramResources.Clone())
    // The arch tile's icon ContentControl binds @TodlVisualSelector (a DynamicResource),
    // registered in the app by registerArchToolboxAdapters — register it here too so
    // the binding resolves exactly as it does in the running app, resolving its two
    // context templates from the merged DiagramResources (as the register site does).
    const tile = app.Resources.Resolve('TodlIconTileTemplate') as DataTemplate
    const figure = app.Resources.Resolve('TodlIconFigureTemplate') as DataTemplate
    app.Resources.Set('TodlVisualSelector', new TodlVisualSelector(tile, figure))
    return app
}

afterEach(() => { Application.current = priorApp; setIconResourceResolver(undefined) })

function find(root: Visual, pred: (v: Visual) => boolean): Visual | undefined {
    if (pred(root)) return root
    for (const c of root.visualChildren) { const r = find(c, pred); if (r !== undefined) return r }
    return undefined
}

const fakeRegistry = (index: Record<string, string> = {}) =>
    ({ iconKeyFor: (k: string) => index[k] }) as unknown as TodlPresentationRegistry

test('shape tile → mural ToolboxVisualPresenter (shape figure) + a wrapping caption', () => {
    const app = withApp()
    const tmpl = app.Resources.Resolve(ToolboxItem) as DataTemplate
    expect(tmpl).toBeInstanceOf(DataTemplate)   // base implicit-by-type template registered

    const item = new ShapeToolboxItem('rectangle', 'Rectangle')
    const root = tmpl.Apply(item); root.DataContext = item

    // Shapes render through the mural presenter (their descriptor → shape figure),
    // NOT the selector — no plain (non-presenter) ContentControl in the tile.
    expect(find(root, (v) => v instanceof ToolboxVisualPresenter)).toBeDefined()
    expect(find(root, (v) => v instanceof ContentControl && !(v instanceof ToolboxVisualPresenter))).toBeUndefined()

    const caption = find(root, (v) => v instanceof TextBlock && (v as TextBlock).Text === 'Rectangle') as TextBlock | undefined
    expect(caption).toBeDefined()
    expect(caption!.TextWrapping).toBe(TextWrapping.Wrap)
})

test('arch term tile → ContentControl + @TodlVisualSelector (Tile context) + caption', () => {
    const app = withApp()
    const tmpl = app.Resources.Resolve(ArchToolboxItem) as DataTemplate
    expect(tmpl).toBeInstanceOf(DataTemplate)   // the more-derived template is registered for ArchToolboxItem

    const desc = new ToolboxVisualDescriptor(ArchToolboxVisualKey, 'svc')
    const icon = new EntityIconVM(fakeRegistry(), 'svc')
    const item = new ArchToolboxItem('instance:1', 'My Service', desc, new ServiceKey<IToolboxDropFactory>('F'), icon, 'service')
    const root = tmpl.Apply(item); root.DataContext = item

    const host = find(root, (v) => v instanceof ContentControl && !(v instanceof ToolboxVisualPresenter)) as ContentControl | undefined
    expect(host).toBeDefined()                                    // icon rendered via a ContentControl
    expect(host!.ContentTemplateSelector).toBeDefined()           // wired to @TodlVisualSelector
    expect(VisualContextScope.GetContext(host!)).toBe(VisualContext.Tile)   // Tile context set in markup

    const caption = find(root, (v) => v instanceof TextBlock && (v as TextBlock).Text === 'My Service') as TextBlock | undefined
    expect(caption).toBeDefined()
})

// P4-slim guard: the two icon templates now live in diagram.resources.mu (compiled
// at build time), not built at runtime by visual-library.ts. Resolving + applying
// them against an EntityIconVM must succeed and yield the Image (raster) + Icon
// (vector) overlay the selector picks between. Stub the icon resolver so the vector
// converter yields a shape without reaching a real asset dictionary.
test('the compiled @TodlIconTile/@TodlIconFigure templates apply an Image + Icon for an EntityIconVM', () => {
    setIconResourceResolver(() => ({ ViewBoxWidth: 24, ViewBoxHeight: 24, Shapes: [] }))
    const app = withApp()
    const vm = new EntityIconVM(fakeRegistry({ svc: 'icon-svc' }), 'svc')

    for (const key of ['TodlIconTileTemplate', 'TodlIconFigureTemplate']) {
        const tmpl = app.Resources.Resolve(key) as DataTemplate
        expect(tmpl).toBeInstanceOf(DataTemplate)
        let root: Visual | undefined
        expect(() => { root = tmpl.Apply(vm); root.DataContext = vm }).not.toThrow()
        expect(find(root!, (v) => v instanceof Image)).toBeDefined()
        expect(find(root!, (v) => v instanceof Icon)).toBeDefined()
    }
})
