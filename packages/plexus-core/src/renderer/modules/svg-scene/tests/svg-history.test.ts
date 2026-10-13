import { test, expect } from 'vitest'
import { SvgHistory } from '../svg-history.js'

test('undo/redo walk the snapshot stack', () => {
    const h = new SvgHistory('a')
    h.Push('b'); h.Push('c')
    expect(h.Current()).toBe('c')
    expect(h.Undo()).toBe('b')
    expect(h.Undo()).toBe('a')
    expect(h.CanUndo()).toBe(false)
    expect(h.Undo()).toBeUndefined()
    expect(h.Redo()).toBe('b')
    expect(h.Redo()).toBe('c')
    expect(h.CanRedo()).toBe(false)
})

test('push equal to current is a no-op (gesture that changed nothing)', () => {
    const h = new SvgHistory('a')
    h.Push('a')
    expect(h.CanUndo()).toBe(false)
})

test('a push after undo truncates the redo branch', () => {
    const h = new SvgHistory('a')
    h.Push('b'); h.Push('c')
    h.Undo()            // at 'b'
    h.Push('d')         // new branch
    expect(h.Current()).toBe('d')
    expect(h.CanRedo()).toBe(false)
    expect(h.Undo()).toBe('b')
})
