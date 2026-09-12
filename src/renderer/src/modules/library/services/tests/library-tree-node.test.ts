import { test, expect } from 'vitest'
import { ToolboxVisualDescriptor, TOOLBOX_ITEM_FORMAT } from '@pragmatic-tech-ai/mural/framework'
import { LibraryTreeNode, LibraryNodeKind } from '../library-tree-node.js'
import { TodlVisualResolverKey } from '../../../diagram/services/todl-visual-resolver.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

// A registry stub exposing iconKeyFor (the EntityIconVM surface).
const reg = (index = new Map<string, string>()) =>
  ({ iconKeyFor: (k: string) => index.get(k) }) as unknown as TodlPresentationRegistry

test('group node: kind, name, empty children, inert (not draggable, no drag payload)', () => {
  const n = LibraryTreeNode.group('Microsoft  ·  0.1.0', LibraryNodeKind.Library)
  expect(n.Kind).toBe(LibraryNodeKind.Library)
  expect(n.Name).toBe('Microsoft  ·  0.1.0')
  expect(n.Children.Count).toBe(0)
  expect(n.IsLibrary).toBe(true)
  expect(n.IsDraggable).toBe(false)
  expect(n.BeginDragData).toBeUndefined()

  const concept = LibraryTreeNode.group('technology', LibraryNodeKind.Concept)
  expect(concept.IsLibrary).toBe(false)
})

test('class leaf: exposes the render surface + a library-class descriptor + a repository-item drag payload', () => {
  const n = LibraryTreeNode.leaf(
    { display: 'Azure OpenAI', label: 'Azure OpenAI', localId: 'AzureOpenai', termId: 'Stack.AzureOpenai', concept: 'technology' },
    reg(new Map([['Stack.AzureOpenai', 'icon-aoai']])),
  )
  expect(n.Kind).toBe(LibraryNodeKind.Class)
  expect(n.Name).toBe('Azure OpenAI')
  expect(n.Display).toBe('Azure OpenAI')
  expect(n.Label).toBe('Azure OpenAI')
  expect(n.LocalId).toBe('AzureOpenai')
  expect(n.TermId).toBe('Stack.AzureOpenai')
  expect(n.Concept).toBe('technology')
  expect(n.Descriptor).toEqual(new ToolboxVisualDescriptor(TodlVisualResolverKey, 'Stack.AzureOpenai'))
  expect(n.Icon!.IconKey).toBe('icon-aoai')   // the preview icon VM resolves the term id
  expect(n.IsLibrary).toBe(false)
  expect(n.IsDraggable).toBe(true)

  const payload = n.BeginDragData!()
  expect(payload.data.Get(TOOLBOX_ITEM_FORMAT)).toBe('term:Stack.AzureOpenai')
})
