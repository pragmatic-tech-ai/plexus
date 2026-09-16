import { test, expect, vi } from 'vitest'
import { Diagram, DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import { attachZoomShortcuts } from '../zoom-shortcuts.js'

// A fake window capturing the single keydown listener.
function fakeTarget() {
    let handler: ((e: KeyboardEvent) => void) | undefined
    return {
        addEventListener: (_t: string, h: EventListenerOrEventListenerObject) => { handler = h as (e: KeyboardEvent) => void },
        removeEventListener: () => { handler = undefined },
        fire: (init: Partial<KeyboardEvent>) => handler?.({ preventDefault() {}, stopPropagation() {}, ...init } as KeyboardEvent),
    }
}

// A real DiagramDocument (so the behavior's `instanceof` guard is exercised) whose
// ActiveView is a real Diagram (so the document's view-mirror wires up) with its
// zoom methods spied.
function hostWithView() {
    const canvas = new Diagram()
    const view = {
        ZoomIn: vi.spyOn(canvas, 'ZoomIn').mockImplementation(() => {}),
        ZoomOut: vi.spyOn(canvas, 'ZoomOut').mockImplementation(() => {}),
        ResetZoom: vi.spyOn(canvas, 'ResetZoom').mockImplementation(() => {}),
    }
    const doc = new DiagramDocument()
    doc.ActiveView = canvas
    return { host: { ActiveDocument: doc }, view }
}

test('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets — on the active diagram view', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    attachZoomShortcuts(host as never, t as never)

    t.fire({ ctrlKey: true, key: '=' })
    t.fire({ ctrlKey: true, key: '-' })
    t.fire({ ctrlKey: true, key: '0' })

    expect(view.ZoomIn).toHaveBeenCalledTimes(1)
    expect(view.ZoomOut).toHaveBeenCalledTimes(1)
    expect(view.ResetZoom).toHaveBeenCalledTimes(1)
})

test('accepts + (shifted key) for zoom-in', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    attachZoomShortcuts(host as never, t as never)
    t.fire({ metaKey: true, key: '+' })
    expect(view.ZoomIn).toHaveBeenCalledTimes(1)
})

test('ignores the chord when no modifier is held', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    attachZoomShortcuts(host as never, t as never)
    t.fire({ key: '=' })
    expect(view.ZoomIn).not.toHaveBeenCalled()
})

test('ignores the chord when the active document is not a diagram', () => {
    const view = { ZoomIn: vi.fn(), ZoomOut: vi.fn(), ResetZoom: vi.fn() }
    const host = { ActiveDocument: { ActiveView: view } }   // not a DiagramDocument
    const t = fakeTarget()
    attachZoomShortcuts(host as never, t as never)
    t.fire({ ctrlKey: true, key: '=' })
    expect(view.ZoomIn).not.toHaveBeenCalled()
})

test('detach removes the listener', () => {
    const { host, view } = hostWithView()
    const t = fakeTarget()
    const detach = attachZoomShortcuts(host as never, t as never)
    detach()
    t.fire({ ctrlKey: true, key: '=' })
    expect(view.ZoomIn).not.toHaveBeenCalled()
})
