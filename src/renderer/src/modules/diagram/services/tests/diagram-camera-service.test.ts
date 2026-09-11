import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiagramDocument, ContentHostService, Diagram, ScrollViewer } from '@pragmatic-tech-ai/mural/framework'
import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramCameraService } from '../diagram-camera-service.js'
import { writeCamera, readCamera, type DiagramCameraState } from '../../persistence/diagram-camera-store.js'

// Minimal per-key property-change listener host, shared by the fake view (for
// Diagram.ZoomKey) and its fake ScrollHost (for the offset keys).
class Listenable {
    private readonly listeners = new Map<unknown, Set<() => void>>()
    public PropertyChanged(key: unknown): { subscribe(fn: () => void): { dispose(): void } } {
        const listeners = this.listeners
        return {
            subscribe(fn: () => void): { dispose(): void } {
                if (!listeners.has(key)) listeners.set(key, new Set())
                listeners.get(key)!.add(fn)
                return { dispose(): void { listeners.get(key)?.delete(fn) } }
            },
        }
    }
    // The document subscribes to the view's ContainerBound signal on ActiveView
    // (container-owned-geometry); no containers realize under this fake.
    public AddContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void {}
    public RemoveContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void {}
    public fire(key: unknown): void { for (const fn of this.listeners.get(key) ?? []) fn() }
}

// A lightweight stand-in for the live Diagram control: it exposes only the
// camera surface the service touches — Camera getter, SetCamera, per-key
// property-change listeners over Diagram.ZoomKey (on the view) and the
// ScrollViewer offset keys (on ScrollHost). Using a fake avoids mounting the
// mural theme to construct a real Diagram under jsdom.
class FakeView extends Listenable {
    private state: DiagramCameraState = { zoom: 1, offsetX: 0, offsetY: 0 }
    public readonly ScrollHost = new Listenable()
    public get Camera(): DiagramCameraState { return this.state }
    public SetCamera(c: DiagramCameraState): void {
        this.state = { zoom: c.zoom, offsetX: c.offsetX, offsetY: c.offsetY }
        this.fire(Diagram.ZoomKey)
        this.ScrollHost.fire(ScrollViewer.HorizontalOffsetKey)
        this.ScrollHost.fire(ScrollViewer.VerticalOffsetKey)
    }
    // Simulate a scrollbar/wheel scroll: the offset changes but the zoom does
    // NOT, so only the ScrollViewer offset keys fire (never Diagram.ZoomKey).
    public Scroll(offsetX: number, offsetY: number): void {
        this.state = { ...this.state, offsetX, offsetY }
        this.ScrollHost.fire(ScrollViewer.HorizontalOffsetKey)
        this.ScrollHost.fire(ScrollViewer.VerticalOffsetKey)
    }
}

function providerWith(host: unknown): { get(k: unknown): unknown; getRequired(k: unknown): unknown } {
    return {
        get: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
        getRequired: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
    }
}

function fakeHost() {
    const OpenDocuments = new ObservableCollection<unknown>()
    return { OpenDocuments } as unknown as { OpenDocuments: ObservableCollection<unknown> }
}

function publish(doc: DiagramDocument, view: FakeView): void {
    doc.ActiveView = view as unknown as Diagram
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('hydrates the published view from stored metadata without re-persisting', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)

    const doc = new DiagramDocument()
    writeCamera(doc, { zoom: 2, offsetX: 10, offsetY: 20 })
    host.OpenDocuments.Add(doc)              // triggers the open-docs subscription

    const view = new FakeView()
    publish(doc, view)                        // publishes the view → hydrate

    expect(view.Camera).toEqual({ zoom: 2, offsetX: 10, offsetY: 20 })
    // Hydration must NOT schedule a persist (guarded): advancing time does not save.
    const save = vi.spyOn(doc, 'Save')
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
})

test('persists (debounced) when the view camera changes', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)

    const save = vi.spyOn(doc, 'Save')
    view.SetCamera({ zoom: 3, offsetX: 5, offsetY: 6 })   // user zoom
    view.SetCamera({ zoom: 3, offsetX: 7, offsetY: 8 })   // and scroll — coalesced
    expect(save).not.toHaveBeenCalled()                   // still within the debounce window
    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readCamera(doc)).toEqual({ zoom: 3, offsetX: 7, offsetY: 8 })
})

test('persists when only the scroll offset changes (zoom unchanged)', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)

    const save = vi.spyOn(doc, 'Save')
    view.Scroll(50, 60)                       // scrollbar drag — no zoom change
    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readCamera(doc)).toEqual({ zoom: 1, offsetX: 50, offsetY: 60 })
})

test('stops persisting after the document closes', () => {
    const host = fakeHost()
    new DiagramCameraService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)

    const save = vi.spyOn(doc, 'Save')
    host.OpenDocuments.Remove(doc)                   // close → detach
    view.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 })
    vi.advanceTimersByTime(500)
    expect(save).not.toHaveBeenCalled()
})
