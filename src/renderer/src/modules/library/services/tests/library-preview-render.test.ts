import { test, expect, afterEach } from 'vitest'
import { Application, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { DataTemplate, TextBlock } from '@pragmatic-tech-ai/mural/basic'
import { ToolboxVisualPresenter } from '@pragmatic-tech-ai/mural/framework'

import { LibraryResources } from '../../library.resources.mu.js'
import { LibraryTreeNode } from '../library-tree-node.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const noIconReg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry

// View-level regression for the bottom preview pane. The preview renders a selected
// class LEAF through an implicit DataTemplate[LibraryTreeNode] that hosts a shared
// ToolboxVisualPresenter bound to the node's Descriptor (which resolves + upgrades
// the class visual) plus the concept label. Applying it for a class node must
// resolve by type and not throw.

let priorApp: Application | null = null

function withApp(): Application {
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    // Merge the real library resources so findDataTemplateForType resolves the
    // implicit preview template exactly as it does in the running app.
    app.Resources.AddMergedDictionary(LibraryResources.Clone())
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

test('the preview template resolves by type and hosts a descriptor-bound presenter + concept label', () => {
    const app = withApp()
    const preview = app.Resources.Resolve(LibraryTreeNode) as DataTemplate
    expect(preview).toBeInstanceOf(DataTemplate)   // implicit-by-type template is registered

    const node = classLeaf('Azure', 'location')

    // Applying the template + propagating DataContext is exactly what the hosting
    // ContentControl does.
    let root: Visual | undefined
    expect(() => { root = preview.Apply(node); root.DataContext = node }).not.toThrow()

    const presenter = find(root!, (v) => v instanceof ToolboxVisualPresenter) as ToolboxVisualPresenter | undefined
    expect(presenter).toBeDefined()
    expect(presenter!.Descriptor?.Key).toBe('t.Azure')   // bound to the node's descriptor
    expect(findText(root!, 'Azure')).toBe(true)           // the host-owned $Display caption
    expect(findText(root!, 'location')).toBe(true)        // the concept label rendered
})

test('each class node binds its own descriptor — no staleness across applications', () => {
    const app = withApp()
    const preview = app.Resources.Resolve(LibraryTreeNode) as DataTemplate

    const nodeA = classLeaf('Azure', 'location')
    const rootA = preview.Apply(nodeA); rootA.DataContext = nodeA
    const nodeB = classLeaf('Kafka', 'technology')
    const rootB = preview.Apply(nodeB); rootB.DataContext = nodeB

    const presA = find(rootA, (v) => v instanceof ToolboxVisualPresenter) as ToolboxVisualPresenter
    const presB = find(rootB, (v) => v instanceof ToolboxVisualPresenter) as ToolboxVisualPresenter
    expect(presA.Descriptor?.Key).toBe('t.Azure')
    expect(presB.Descriptor?.Key).toBe('t.Kafka')
})
