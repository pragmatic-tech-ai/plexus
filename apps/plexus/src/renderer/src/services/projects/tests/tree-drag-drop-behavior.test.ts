import { test, expect } from 'vitest'
import { Border } from '@pragmatic-tech-ai/mural/basic'
import { DragDropEffects, type DragStartSpec } from '@pragmatic-tech-ai/mural/visual-engine'

import { TreeDragDropBehavior } from '../tree-drag-drop-behavior.js'
import { ProjectNode } from '../project.js'

// The DataObject format key the behavior packs the dragged nodes under
// (mirrors NODES_FORMAT in tree-drag-drop-behavior.ts).
const NODES_FORMAT = 'plexus/project-nodes'

// Regression: in the data-driven project TreeView, a row's DataContext is NOT
// yet bound when its `.Behaviors:` attach (materialization order: behaviors
// attach before DataContext propagates to the template subtree). The behavior
// must therefore NOT gate `IsDraggable` on a one-time DataContext read at
// attach — doing so left every row non-draggable, so drag never started.
test('arms IsDraggable at attach even when DataContext is not yet bound', () => {
    const row = new Border()
    expect(row.DataContext).toBeUndefined()   // exactly the materialization-time state

    row.AddBehavior(new TreeDragDropBehavior())

    expect(row.IsDraggable).toBe(true)
    expect(row.OnDragStart).toBeTypeOf('function')
    expect(row.AllowDrop).toBe(true)
})

// The ProjectNode decision is deferred to drag time, when DataContext IS
// present: a node host produces a Move spec carrying that node; a non-node
// host (e.g. the project header, DataContext = OpenProject) produces null, so
// only real nodes actually start a drag.
test('startDrag reads DataContext at drag time — node → spec, non-node → null', () => {
    const row = new Border()
    row.AddBehavior(new TreeDragDropBehavior())

    const node = new ProjectNode('a.todl', 'a.todl', 'todl')
    row.DataContext = node
    const spec = row.OnDragStart!(row) as DragStartSpec | null
    expect(spec).not.toBeNull()
    expect(spec!.effects).toBe(DragDropEffects.Move)
    expect(spec!.data.Get<readonly ProjectNode[]>(NODES_FORMAT)).toEqual([node])

    row.DataContext = { not: 'a node' }
    expect(row.OnDragStart!(row)).toBeNull()
})
