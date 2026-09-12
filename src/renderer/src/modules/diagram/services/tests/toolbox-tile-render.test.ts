import { test, expect, afterEach } from 'vitest'
import { Application, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { DataTemplate, TextBlock, TextWrapping } from '@pragmatic-tech-ai/mural/basic'
import { ContentControl, ShapeToolboxItem, ToolboxItem, VisualContext, VisualContextScope } from '@pragmatic-tech-ai/mural/framework'

import { DiagramResources } from '../../diagram.resources.mu.js'
import { TodlVisualSelector } from '../todl-visual-selector.js'

// View-level regression for the toolbox tile. The tile renders any repository item
// through a ContentControl + @TodlVisualSelector (Tile context) with a host-owned
// caption below it — bound to the item's $Label, wrapping. Resolving the implicit
// DataTemplate[ToolboxItem] for a shape item must host the icon host AND the caption.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    app.Resources.AddMergedDictionary(DiagramResources.Clone())
    // The tile's icon ContentControl binds @TodlVisualSelector (a DynamicResource),
    // registered in the app by registerArchToolboxAdapters — register it here too so
    // the binding resolves exactly as it does in the running app.
    app.Resources.Set('TodlVisualSelector', new TodlVisualSelector())
    return app
}

afterEach(() => { Application.current = priorApp })

function find(root: Visual, pred: (v: Visual) => boolean): Visual | undefined {
    if (pred(root)) return root
    for (const c of root.visualChildren) { const r = find(c, pred); if (r !== undefined) return r }
    return undefined
}

test('the tile hosts the icon ContentControl (Tile context) + a wrapping $Label caption', () => {
    const app = withApp()
    const tmpl = app.Resources.Resolve(ToolboxItem) as DataTemplate
    expect(tmpl).toBeInstanceOf(DataTemplate)   // implicit-by-type template is registered

    const item = new ShapeToolboxItem('rectangle', 'Rectangle')
    const root = tmpl.Apply(item); root.DataContext = item

    const host = find(root, (v) => v instanceof ContentControl) as ContentControl | undefined
    expect(host).toBeDefined()                                   // icon rendered via a ContentControl
    expect(host!.ContentTemplateSelector).toBeDefined()          // wired to @TodlVisualSelector
    expect(VisualContextScope.GetContext(host!)).toBe(VisualContext.Tile)   // Tile context set in markup

    const caption = find(root, (v) => v instanceof TextBlock && (v as TextBlock).Text === 'Rectangle') as TextBlock | undefined
    expect(caption).toBeDefined()                       // the item Label rendered as the caption
    expect(caption!.TextWrapping).toBe(TextWrapping.Wrap)   // long names wrap in the tile
})
