import { test, expect, afterEach } from 'vitest'
import { Application, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { Border, DataTemplate, TextBlock } from '@pragmatic-tech-ai/mural/basic'
import { ContentControl, VisualContext, VisualContextScope } from '@pragmatic-tech-ai/mural/framework'

import { LibraryResources } from '../../library.resources.mu.js'
import { LibraryTreeNode } from '../library-tree-node.js'
import { TodlVisualSelector } from '../../../diagram/services/todl-visual-selector.js'
import type { EntityIconVM } from '../../../diagram/services/entity-icon-vm.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const noIconReg = { iconKeyFor: () => undefined, onChanged: () => () => {} } as unknown as TodlPresentationRegistry

// View-level regression for the bottom preview pane. The preview renders a selected
// class LEAF through an implicit DataTemplate[LibraryTreeNode] that hosts a
// ContentControl + @TodlVisualSelector (Tile context) bound to the leaf's $Icon
// (its EntityIconVM) plus the concept label. Applying it for a class node must
// resolve by type and not throw.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    // Merge the real library resources so findDataTemplateForType resolves the
    // implicit preview template exactly as it does in the running app, and register
    // the @TodlVisualSelector resource the preview ContentControl binds (registered
    // in the app by registerArchToolboxAdapters).
    app.Resources.AddMergedDictionary(LibraryResources.Clone())
    // The preview only checks the ContentControl wiring (selector + Tile context +
    // $Icon binding + caption); it never applies the selector's returned template, so
    // sentinel context templates suffice (the real ones live in DiagramResources).
    app.Resources.Set('TodlVisualSelector',
        new TodlVisualSelector(new DataTemplate(() => new Border()), new DataTemplate(() => new Border())))
    return app
}

afterEach(() => { Application.current = priorApp })

function find(root: Visual, pred: (v: Visual) => boolean): Visual | undefined {
    if (pred(root)) return root
    for (const c of root.visualChildren) { const r = find(c, pred); if (r !== undefined) return r }
    return undefined
}
function findText(root: Visual, text: string): boolean {
    return find(root, (v) => v instanceof TextBlock && v.Text === text) !== undefined
}
function classLeaf(display: string, concept: string): LibraryTreeNode {
    return LibraryTreeNode.leaf({ display, label: display, localId: display, termId: `t.${display}`, concept }, noIconReg)
}

test('the preview template resolves by type and hosts an $Icon-bound ContentControl + concept label', () => {
    const app = withApp()
    const preview = app.Resources.Resolve(LibraryTreeNode) as DataTemplate
    expect(preview).toBeInstanceOf(DataTemplate)   // implicit-by-type template is registered

    const node = classLeaf('Azure', 'location')

    // Applying the template + propagating DataContext is exactly what the hosting
    // ContentControl does.
    let root: Visual | undefined
    expect(() => { root = preview.Apply(node); root.DataContext = node }).not.toThrow()

    const host = find(root!, (v) => v instanceof ContentControl) as ContentControl | undefined
    expect(host).toBeDefined()
    expect(host!.ContentTemplateSelector).toBeDefined()                     // wired to @TodlVisualSelector
    expect(VisualContextScope.GetContext(host!)).toBe(VisualContext.Tile)   // Tile context set in markup
    expect((host!.Content as EntityIconVM | undefined)).toBe(node.Icon)     // bound to the leaf's $Icon
    expect(findText(root!, 'Azure')).toBe(true)           // the host-owned $Display caption
    expect(findText(root!, 'location')).toBe(true)        // the concept label rendered
})

test('each class node binds its own $Icon — no staleness across applications', () => {
    const app = withApp()
    const preview = app.Resources.Resolve(LibraryTreeNode) as DataTemplate

    const nodeA = classLeaf('Azure', 'location')
    const rootA = preview.Apply(nodeA); rootA.DataContext = nodeA
    const nodeB = classLeaf('Kafka', 'technology')
    const rootB = preview.Apply(nodeB); rootB.DataContext = nodeB

    const hostA = find(rootA, (v) => v instanceof ContentControl) as ContentControl
    const hostB = find(rootB, (v) => v instanceof ContentControl) as ContentControl
    expect(hostA.Content).toBe(nodeA.Icon)
    expect(hostB.Content).toBe(nodeB.Icon)
})
