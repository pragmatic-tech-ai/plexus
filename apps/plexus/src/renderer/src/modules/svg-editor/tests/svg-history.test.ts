import { test, expect } from 'vitest'
import { SvgHistory } from '../svg-history.js'

test('undo/redo walk the snapshot stack', () => {
    const h = new SvgHistory('a')
    h.push('b'); h.push('c')
    expect(h.current()).toBe('c')
    expect(h.undo()).toBe('b')
    expect(h.undo()).toBe('a')
    expect(h.canUndo()).toBe(false)
    expect(h.undo()).toBeUndefined()
    expect(h.redo()).toBe('b')
    expect(h.redo()).toBe('c')
    expect(h.canRedo()).toBe(false)
})

test('push equal to current is a no-op (gesture that changed nothing)', () => {
    const h = new SvgHistory('a')
    h.push('a')
    expect(h.canUndo()).toBe(false)
})

test('a push after undo truncates the redo branch', () => {
    const h = new SvgHistory('a')
    h.push('b'); h.push('c')
    h.undo()            // at 'b'
    h.push('d')         // new branch
    expect(h.current()).toBe('d')
    expect(h.canRedo()).toBe(false)
    expect(h.undo()).toBe('b')
})
