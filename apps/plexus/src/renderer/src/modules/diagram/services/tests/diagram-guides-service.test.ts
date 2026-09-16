import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiagramDocument, ContentHostService, Diagram } from '@pragmatic-tech-ai/mural/framework'
import { ObservableCollection, AlignmentAxis } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramGuidesService } from '../diagram-guides-service.js'
import { writeGuides, readGuides } from '../../persistence/diagram-guides-store.js'
import type { PersistentGuide } from '@pragmatic-tech-ai/mural/runtime'

// Per-key property-change listener host, standing in for the live Diagram's
// Guides DP notifications without mounting the mural theme under jsdom.
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
    // The document subscribes to the view's ContainerBound signal when it becomes
    // ActiveView (container-owned-geometry). No containers realize under this
    // fake, so these are no-ops.
    public AddContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void {}
    public RemoveContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void {}
    public fire(key: unknown): void { for (const fn of this.listeners.get(key) ?? []) fn() }
}

class FakeView extends Listenable {
    private guides: readonly PersistentGuide[] = []
    public get Guides(): readonly PersistentGuide[] { return this.guides }
    public set Guides(v: readonly PersistentGuide[]) { this.guides = v; this.fire(Diagram.GuidesKey) }
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
function publish(doc: DiagramDocument, view: FakeView): void { doc.ActiveView = view as unknown as Diagram }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('hydrates the published view from stored guides without re-persisting', () => {
    const host = fakeHost()
    new DiagramGuidesService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    writeGuides(doc, { guides: [{ axis: AlignmentAxis.X, position: 200, glued: [] }] })
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)
    expect(view.Guides.length).toBe(1)
    expect(view.Guides[0]!.position).toBe(200)
    const save = vi.spyOn(doc, 'Save')
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
})

test('persists (debounced) when the view guides change', () => {
    const host = fakeHost()
    new DiagramGuidesService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)
    const save = vi.spyOn(doc, 'Save')
    view.Guides = [{ axis: AlignmentAxis.Y, position: 90, glued: [] }]
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(readGuides(doc)?.guides[0]!.position).toBe(90)
})

test('stops persisting after the document closes', () => {
    const host = fakeHost()
    new DiagramGuidesService(providerWith(host) as never, 500)
    const doc = new DiagramDocument()
    host.OpenDocuments.Add(doc)
    const view = new FakeView()
    publish(doc, view)
    const save = vi.spyOn(doc, 'Save')
    host.OpenDocuments.Remove(doc)
    view.Guides = [{ axis: AlignmentAxis.X, position: 10, glued: [] }]
    vi.advanceTimersByTime(500)
    expect(save).not.toHaveBeenCalled()
})
