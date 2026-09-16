import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'

import { MetaModelTreeNode, MetaModelNodeKind, type EntityRef } from '../meta-model-tree-node.js'

test('leaf() has the given kind + label and no children', () => {
    const n = MetaModelTreeNode.leaf(MetaModelNodeKind.Model, 'tech-architecture')
    expect(n.Kind).toBe(MetaModelNodeKind.Model)
    expect(n.Label).toBe('tech-architecture')
    expect(n.Children.Count).toBe(0)
})

test('lazy() seeds a single "Loading…" sentinel child so the chevron shows', () => {
    const n = MetaModelTreeNode.lazy(MetaModelNodeKind.Version, '0.1.0', async () => [])
    expect(n.Kind).toBe(MetaModelNodeKind.Version)
    expect(n.Children.Count).toBe(1)
    expect(n.Children.Get(0)!.Label).toBe('Loading…')
})

test('OnExpand runs the loader once and replaces the sentinel with its result', async () => {
    let calls = 0
    const n = MetaModelTreeNode.lazy(MetaModelNodeKind.Version, '0.1.0', async () => {
        calls++
        return [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Actor')]
    })

    n.OnExpand()
    n.OnExpand()                 // second expand must not re-run the loader
    await Promise.resolve()      // let the async populate settle
    await Promise.resolve()

    expect(calls).toBe(1)
    expect(n.Children.Count).toBe(1)
    expect(n.Children.Get(0)!.Label).toBe('Actor')
})

test('OnExpand replaces the sentinel with an error leaf when the loader rejects', async () => {
    const n = MetaModelTreeNode.lazy(MetaModelNodeKind.Version, '0.1.0', async () => {
        throw new Error('boom')
    })

    n.OnExpand()
    await Promise.resolve()
    await Promise.resolve()

    expect(n.Children.Count).toBe(1)
    expect(n.Children.Get(0)!.Label).toBe('Failed to load model.json')
})

test('an entity node calls activate(ref) on OnActivate', () => {
    const ref: EntityRef = { modelId: 'tech-architecture', version: '0.1.0', id: 'application' }
    let got: EntityRef | undefined
    const node = MetaModelTreeNode.entity('Application', ref, (r) => { got = r })
    node.OnActivate()
    expect(got).toEqual(ref)
})

test('a non-entity leaf node does nothing on OnActivate', () => {
    const node = MetaModelTreeNode.leaf(MetaModelNodeKind.Group, 'Concepts')
    expect(() => node.OnActivate()).not.toThrow()
})

test('IsDeletable is true for Model and Version, false for Group and Entity', () => {
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Model, 'a').IsDeletable).toBe(true)
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Version, '1.0.0').IsDeletable).toBe(true)
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Group, 'Concepts').IsDeletable).toBe(false)
    expect(MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'x').IsDeletable).toBe(false)
})

test('ModelId / ModelVersion / DeleteCommand round-trip', () => {
    const n = MetaModelTreeNode.leaf(MetaModelNodeKind.Version, '1.0.0')
    n.ModelId = 'a'
    n.ModelVersion = '1.0.0'
    const cmd = new RelayCommand(() => {})
    n.DeleteCommand = cmd
    expect(n.ModelId).toBe('a')
    expect(n.ModelVersion).toBe('1.0.0')
    expect(n.DeleteCommand).toBe(cmd)
})
