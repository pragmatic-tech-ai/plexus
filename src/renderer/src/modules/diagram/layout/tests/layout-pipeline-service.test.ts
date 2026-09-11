import { test, expect, describe } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import {
    ConnectorEndpoint,
    ContentHostService,
    Diagram,
    DiagramDocument,
    Figure,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import { Point } from '@pragmatic-tech-ai/mural/runtime'
import { LayoutPipelineService } from '../layout-pipeline-service.js'
import { PresetScope } from '../preset-scope.js'
import { GetPipelineCatalog, type PipelineConfiguration } from '@pragmatic-tech-ai/fresco'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { FileDiagramStorage } from '../../persistence/file-diagram-storage.js'
import { readLayoutConfig, saveDiagramPreset, getDiagramPreset } from '../../persistence/diagram-layout-store.js'
import type { IStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'

// A provider whose content host reports `doc` as the active document — the
// same ActiveDocument source the arch binding / viewpoint-scope services read.
function providerWithActive(doc: IDocument | undefined): ServiceProvider {
    const host = {
        ActiveDocument: doc,
        OpenDocuments: new ObservableCollection<IDocument>(doc ? [doc] : []),
    } as unknown as DocumentsContentHostService
    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    return provider
}

// A provider with an in-memory filesystem host seeded with `presets`
// (name -> config), plus the active-document host, so LoadPreset / SelectedPreset
// can read real preset files.
function providerWithPresets(doc: IDocument | undefined, presets: Record<string, PipelineConfiguration>): ServiceProvider {
    const provider = providerWithActive(doc)
    const files = new Map<string, string>()
    for (const [name, cfg] of Object.entries(presets)) files.set(`/data/layout-presets/${name}.json`, JSON.stringify(cfg))
    const fs = {
        CreateDirectory: () => Promise.resolve(),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        ReadText: (p: string) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        Delete: (p: string) => { files.delete(p); return Promise.resolve() },
        ListDirectory: (dir: string) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            return Promise.resolve([...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false })))
        },
    } as unknown as FileSystemService
    provider.registerInstance(FileSystemService.Key, fs)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    return provider
}

// The catalog's first real strategy for a given slot — used to build a preset
// whose className the stage VM can resolve.
function firstStrategy(slotId: string): { name: string; className: string } {
    const slot = GetPipelineCatalog().find((s) => s.slotId === slotId && s.kind === 'strategy-slot')!
    const strat = (slot as unknown as { strategies: { name: string; className: string }[] }).strategies[0]
    return { name: strat.name, className: strat.className }
}

test('Run lays out the ACTIVE diagram document, not a workspace singleton', () => {
    const doc = new DiagramDocument()
    const a = Figure.fromKind('rectangle', 0, 0);   a.Id = 'a'
    const b = Figure.fromKind('rectangle', 300, 0); b.Id = 'b'
    doc.AddNode(a); doc.AddNode(b)

    const svc = new LayoutPipelineService(providerWithActive(doc))
    svc.Run()

    // Reached the active doc and found its two nodes (the old wiring read an
    // empty workspace singleton → 'no nodes').
    expect(svc.Status).toContain('Laid out')
    expect(svc.Status).not.toContain('no nodes')
})

test('running the layout clears connector waypoints (reset to auto)', () => {
    const doc = new DiagramDocument()
    const a = Figure.fromKind('rectangle', 0, 0);   a.Id = 'a'
    const b = Figure.fromKind('rectangle', 300, 0); b.Id = 'b'
    doc.AddNode(a); doc.AddNode(b)
    const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))!
    c.Waypoints = [{ point: new Point(150, 60), userAltered: true }]   // a user pin
    expect(c.Waypoints!.length).toBe(1)

    new LayoutPipelineService(providerWithActive(doc)).Run()

    // Layout is the reset — the pin is gone and the route rebuilds automatically.
    expect(c.Waypoints).toBeUndefined()
})

test('Run lays out a CYCLIC diagram without a DAG pipeline error', () => {
    // Reproduces the reported failure: an architecture diagram with a cycle
    // (a → b → a) drove the longest-path layer assigner to throw
    // 'longest-path depths require a DAG'. The default config now runs
    // MakeAcyclicTransform first, so the cycle is broken and layout succeeds.
    const doc = new DiagramDocument()
    const a = Figure.fromKind('rectangle', 0, 0);   a.Id = 'a'
    const b = Figure.fromKind('rectangle', 300, 0); b.Id = 'b'
    doc.AddNode(a); doc.AddNode(b)
    doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))
    doc.CreateConnector(new ConnectorEndpoint({ Node: b }), new ConnectorEndpoint({ Node: a }))   // closes the cycle

    const svc = new LayoutPipelineService(providerWithActive(doc))
    svc.Run()

    expect(svc.Status).toContain('Laid out')
    expect(svc.Status).not.toContain('Pipeline error')
})

test('Run reports when the active document is not a diagram', () => {
    const svc = new LayoutPipelineService(providerWithActive(undefined))
    svc.Run()
    expect(svc.Status).toBe('Active document is not a diagram.')
})

test('LoadPreset clones the preset into Config and restores the matching stage', async () => {
    const strat = firstStrategy('layer-assigner')
    const preset: PipelineConfiguration = {
        name: 'p1', transforms: ['MakeAcyclicTransform'],
        layout: { layerAssigner: { className: strat.className, params: {} } },
    }
    const svc = new LayoutPipelineService(providerWithPresets(undefined, { p1: preset }))

    await svc.LoadPreset('p1')

    expect(svc.Config.name).toBe('p1')
    expect(svc.Config).not.toBe(preset)   // a clone, not the same reference
    const stage = svc.Stages.ToArray().find((s) => s.Label === 'Layer Assigner')!
    expect(stage.Selected).toBe(strat.name)
})

test('LoadPreset of an unknown name leaves Config unchanged', async () => {
    const svc = new LayoutPipelineService(providerWithPresets(undefined, {}))
    const before = svc.Config
    await svc.LoadPreset('missing')
    expect(svc.Config).toBe(before)
})

// ── per-diagram persistence + scoped presets ─────────────────────────────────

// An in-memory IStorage for the project-scoped preset backend.
function memStorage(): IStorage {
    const files = new Map<string, string>()
    return {
        Root: 'mem',
        ReadText: (p) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        WriteText: (p, c) => { files.set(p, c); return Promise.resolve() },
        Delete: (p) => { files.delete(p); return Promise.resolve() },
        CreateDirectory: () => Promise.resolve(),
        List: (dir) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            const out: StorageEntry[] = [...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false }))
            return Promise.resolve(out)
        },
    } as unknown as IStorage
}

// A content host that supports active-document switching with property-change
// notification (the fake in providerWithActive is a static cast — this one lets
// the service's ActiveDocument listener fire).
class NotifyingHost {
    private _active: IDocument | undefined
    private readonly listeners: Array<() => void> = []
    public readonly OpenDocuments = new ObservableCollection<IDocument>()
    public constructor(active?: IDocument) { this._active = active; if (active) this.OpenDocuments.Add(active) }
    public get ActiveDocument(): IDocument | undefined { return this._active }
    public PropertyChanged(_key: unknown): { subscribe(cb: () => void): { dispose(): void } } {
        const listeners = this.listeners
        return {
            subscribe(cb: () => void): { dispose(): void } {
                listeners.push(cb)
                return { dispose(): void { const i = listeners.indexOf(cb); if (i !== -1) listeners.splice(i, 1) } }
            },
        }
    }
    public setActive(doc: IDocument | undefined): void { this._active = doc; for (const cb of this.listeners) cb() }
}

function providerWithHost(host: NotifyingHost): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    return provider
}

// A diagram with a saved working config in its metadata.
function docWithConfig(name: string): DiagramDocument {
    const doc = new DiagramDocument()
    doc.Metadata = { 'layout.config': { name, transforms: ['MakeAcyclicTransform'], layout: {} } }
    return doc
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

test('activating a diagram hydrates the inspector from its saved working config', () => {
    const host = new NotifyingHost(docWithConfig('saved'))
    const svc = new LayoutPipelineService(providerWithHost(host))
    // Hydrated at construction from the initially-active document.
    expect(svc.Config.name).toBe('saved')
})

test('switching to a diagram with no saved config resets to the default', () => {
    const host = new NotifyingHost(docWithConfig('saved'))
    const svc = new LayoutPipelineService(providerWithHost(host))
    expect(svc.Config.name).toBe('saved')

    host.setActive(new DiagramDocument())   // no saved config
    expect(svc.Config.name).toBe('default')
})

test('editing a stage autosaves the working config into the active diagram metadata', async () => {
    const doc = new DiagramDocument()
    const host = new NotifyingHost(doc)
    const svc = new LayoutPipelineService(providerWithHost(host), 0)   // no debounce delay
    expect(readLayoutConfig(doc)).toBeUndefined()

    const strat = firstStrategy('layer-assigner')
    const stage = svc.Stages.ToArray().find((s) => s.Label === 'Layer Assigner')!
    stage.Selected = strat.name

    await tick()
    const saved = readLayoutConfig(doc)
    expect(saved).toBeDefined()
    expect((saved!.layout as Record<string, { className: string }>).layerAssigner.className).toBe(strat.className)
})

test('availableScopes reflects the active document', () => {
    // No active diagram → Global only.
    expect(new LayoutPipelineService(providerWithHost(new NotifyingHost())).availableScopes()).toEqual([PresetScope.Global])

    // A plain diagram (no project storage) → Global + Diagram.
    expect(new LayoutPipelineService(providerWithHost(new NotifyingHost(new DiagramDocument()))).availableScopes())
        .toEqual([PresetScope.Global, PresetScope.Diagram])

    // A project-backed diagram → all three.
    const doc = new DiagramDocument()
    doc.Storage = new FileDiagramStorage('d.diagram', memStorage(), null)
    expect(new LayoutPipelineService(providerWithHost(new NotifyingHost(doc))).availableScopes())
        .toEqual([PresetScope.Global, PresetScope.Project, PresetScope.Diagram])
})

test('the preset list aggregates diagram-scoped presets of the active diagram', async () => {
    const doc = new DiagramDocument()
    saveDiagramPreset(doc, 'inline', { name: 'inline', transforms: [], layout: {} })
    const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
    await tick()   // refreshPresets is async

    const diagramRefs = svc.Presets.ToArray().filter((r) => r.Scope === PresetScope.Diagram)
    expect(diagramRefs.map((r) => r.Name)).toEqual(['inline'])
    expect(diagramRefs[0]!.Label).toBe('inline — diagram')
})

test('selecting a diagram-scoped preset loads it into Config', async () => {
    const doc = new DiagramDocument()
    saveDiagramPreset(doc, 'inline', { name: 'inline', transforms: ['MakeAcyclicTransform'], layout: {} })
    const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
    await tick()

    const ref = svc.Presets.ToArray().find((r) => r.Scope === PresetScope.Diagram && r.Name === 'inline')!
    svc.SelectedPreset = ref
    await tick()   // loadRef is async
    expect(svc.Config.name).toBe('inline')
})

// A diagram with two figure nodes + an a->b connector and a mounted (bare) view,
// active in the host — enough for the pipeline to run and the preview overlay to
// be published on the view.
function diagramDocWithEdge(): { doc: DiagramDocument; view: Diagram; a: Figure; b: Figure } {
    const doc = new DiagramDocument()
    const a = Figure.fromKind('rectangle', 0, 0);   a.Id = 'a'
    const b = Figure.fromKind('rectangle', 300, 0); b.Id = 'b'
    doc.AddNode(a); doc.AddNode(b)
    doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))
    const view = new Diagram()
    doc.ActiveView = view
    return { doc, view, a, b }
}

describe('layout preview', () => {
    test('Preview publishes nodes + edges on the view without moving figures', () => {
        const { doc, view, a } = diagramDocWithEdge()
        const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
        const beforeLeft = a.Left, beforeTop = a.Top

        svc.Preview()

        expect(svc.PreviewActive).toBe(true)
        // PreviewInactive mirrors PreviewActive — it collapses the non-preview
        // controls (presets/Save/Delete/Preview/Run) in the strip while previewing.
        expect(svc.PreviewInactive).toBe(false)
        expect(view.LayoutPreview).toBeDefined()
        expect(view.LayoutPreview!.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
        expect(view.LayoutPreview!.edges).toEqual([{ from: 'a', to: 'b' }])
        // figures are untouched — it's a preview
        expect(a.Left).toBe(beforeLeft)
        expect(a.Top).toBe(beforeTop)
    })

    test('ApplyPreview commits the previewed positions and clears the overlay', () => {
        const { doc, view, a, b } = diagramDocWithEdge()
        const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
        svc.Preview()
        const target = view.LayoutPreview!.nodes.find((n) => n.id === 'a')!

        svc.ApplyPreview()

        expect(svc.PreviewActive).toBe(false)
        // the non-preview controls come back once the preview clears
        expect(svc.PreviewInactive).toBe(true)
        expect(view.LayoutPreview).toBeUndefined()
        // node 'a' moved to its previewed position
        expect(a.Left).toBe(target.left)
        expect(a.Top).toBe(target.top)
        // and the layout actually rearranged (a above b, not side-by-side at y=0)
        expect(b.Top).not.toBe(a.Top)
    })

    test('CancelPreview clears the overlay and moves nothing', () => {
        const { doc, view, a } = diagramDocWithEdge()
        const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
        const beforeLeft = a.Left, beforeTop = a.Top
        svc.Preview()

        svc.CancelPreview()

        expect(svc.PreviewActive).toBe(false)
        expect(view.LayoutPreview).toBeUndefined()
        expect(a.Left).toBe(beforeLeft)
        expect(a.Top).toBe(beforeTop)
    })

    test('editing the config while previewing discards the preview', () => {
        const { doc, view } = diagramDocWithEdge()
        const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)), 0)
        svc.Preview()
        expect(svc.PreviewActive).toBe(true)

        const strat = firstStrategy('position-computer')
        const stage = svc.Stages.ToArray().find((s) => s.Label === 'Position Computer')!
        stage.Selected = strat.name   // a real edit → onConfigChanged → clearPreview

        expect(svc.PreviewActive).toBe(false)
        expect(view.LayoutPreview).toBeUndefined()
    })
})

describe('scoped save / delete', () => {
    test('saving to Diagram scope writes the preset into the document metadata', async () => {
        const doc = new DiagramDocument()
        const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
        await (svc as unknown as { savePreset(n: string, s: PresetScope, c: PipelineConfiguration): Promise<string> })
            .savePreset('d1', PresetScope.Diagram, svc.Config)
        expect(getDiagramPreset(doc, 'd1')).toBeDefined()
    })

    test('deleting a selected diagram-scoped preset removes it from metadata and the list', async () => {
        const doc = new DiagramDocument()
        saveDiagramPreset(doc, 'gone', { name: 'gone', transforms: [], layout: {} })
        const svc = new LayoutPipelineService(providerWithHost(new NotifyingHost(doc)))
        await tick()

        svc.SelectedPreset = svc.Presets.ToArray().find((r) => r.Scope === PresetScope.Diagram && r.Name === 'gone')
        await (svc as unknown as { deleteSelected(): Promise<void> }).deleteSelected()

        expect(getDiagramPreset(doc, 'gone')).toBeUndefined()
        expect(svc.Presets.ToArray().some((r) => r.Name === 'gone')).toBe(false)
    })
})
