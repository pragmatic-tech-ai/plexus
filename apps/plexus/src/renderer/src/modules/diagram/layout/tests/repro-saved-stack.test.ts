// Regression: the saved-diagram connector stacking. Rebuilds the exact topology
// from the user's diagram.diagram, runs the REAL layout pipeline, then asserts
// the three shared sides still fan into distinct slots (layout alone must not
// collapse them onto a side centre) under both the default and the native-side
// router configs.

import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import {
    ConnectorEndpoint,
    Connector,
    ContentHostService,
    DiagramDocument,
    Figure,
    PortSide,
    type ResolvedPortSide,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import '@pragmatic-tech-ai/mural/framework/diagram/routing/straight-router.js'
import '@pragmatic-tech-ai/mural/framework/diagram/routing/orthogonal-router.js'
import { LayoutPipelineService } from '../layout-pipeline-service.js'

// Nodes are modelled as shape Figures — the geometry-owning, side-endpoint-host
// form every diagram node resolves to (a content node's container IS a Figure).
// This keeps the repro headless (no mounted view) while exercising the real
// Plexus layout pipeline + mural side-slot distribution.

const NODES: Record<string, { left: number; top: number }> = {
    component5:  { left: 413.6, top: 448.25 },
    component6:  { left: 115.5, top: 235 },
    n8:          { left: 115.5, top: 460.25 },
    n9:          { left: 264.6, top: 844.5 },
    n10:         { left: 619.5, top: 247 },
    n11:         { left: 351,   top: 66 },
    component7:  { left: 839.5, top: 832.5 },
    component8:  { left: 820.7, top: 448.25 },
    component9:  { left: 1149,  top: 438.25 },
    component10: { left: 827.6, top: 159 },
    n12:         { left: 424,   top: 639.125 },
    n13:         { left: 619.5, top: 460.25 },
}

const EDGES: [string, ResolvedPortSide, string, ResolvedPortSide][] = [
    ['n8', PortSide.S, 'n9', PortSide.N],
    ['component8', PortSide.S, 'component7', PortSide.N],
    ['n10', PortSide.S, 'n13', PortSide.N],
    ['component5', PortSide.S, 'n12', PortSide.N],
    ['n12', PortSide.S, 'n9', PortSide.N],
    ['component10', PortSide.S, 'component8', PortSide.N],
    ['component8', PortSide.E, 'component9', PortSide.W],
    ['component6', PortSide.S, 'n8', PortSide.N],
    ['component6', PortSide.N, 'n11', PortSide.W],
    ['n11', PortSide.E, 'n10', PortSide.N],
    ['n11', PortSide.N, 'component10', PortSide.N],
    ['component6', PortSide.E, 'n11', PortSide.S],
    ['n8', PortSide.W, 'n11', PortSide.W],
    ['n10', PortSide.W, 'n11', PortSide.S],
    ['component5', PortSide.E, 'n13', PortSide.W],
    ['n13', PortSide.E, 'component8', PortSide.W],
    ['n8', PortSide.E, 'component5', PortSide.W],
    ['n9', PortSide.E, 'component7', PortSide.W],
    ['component7', PortSide.E, 'component9', PortSide.S],
]

function providerWithActive(doc: IDocument): ServiceProvider {
    const host = {
        ActiveDocument: doc,
        OpenDocuments: new ObservableCollection<IDocument>([doc]),
    } as unknown as DocumentsContentHostService
    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as unknown as ContentHostService)
    return provider
}

function buildDoc(): { doc: DiagramDocument; vms: Record<string, Figure>; conns: Connector[] } {
    const doc = new DiagramDocument()
    const vms: Record<string, Figure> = {}
    for (const [id, p] of Object.entries(NODES)) {
        const vm = Figure.fromKind('rectangle', p.left, p.top, { width: 80, height: 80 })
        vm.Id = id
        vms[id] = vm; doc.AddNode(vm)
    }
    const conns: Connector[] = []
    for (const [s, ss, t, ts] of EDGES) {
        const c = doc.CreateConnector(
            new ConnectorEndpoint({ Node: vms[s], PortSide: ss }),
            new ConnectorEndpoint({ Node: vms[t], PortSide: ts }))!
        conns.push(c)
    }
    return { doc, vms, conns }
}

const SHARED: [string, ResolvedPortSide][] = [['n9', PortSide.N], ['n11', PortSide.W], ['n11', PortSide.S]]

test('shared sides survive a DEFAULT layout run without stacking', () => {
    const { doc, vms } = buildDoc()

    new LayoutPipelineService(providerWithActive(doc)).Run()

    for (const [id, side] of SHARED) {
        expect(vms[id]!.GetSideEndpointCount(side), `${id}|${side} count after default layout`).toBe(2)
    }
})

test('shared sides survive a NATIVE-side-router layout run without stacking', () => {
    const { doc, conns } = buildDoc()

    const svc = new LayoutPipelineService(providerWithActive(doc))
    // Select the diagram-native edge router — this engages applyDiagramSides,
    // which rewrites each connector's PortSide from the layout's computed
    // sides (and turns Fresco's own port assigner off).
    svc.Config.layout.edgeRouter  = { className: 'CardinalSideRouter' }
    svc.Config.layout.portAssigner = { off: true }
    svc.Run()

    // After a native-router layout, count how many connectors each node hosts
    // per side, and flag any side where two connectors resolved to the SAME
    // slot index (the stacking signature).
    const bySide = new Map<string, number[]>()
    for (const c of conns) {
        for (const e of [c.Source, c.Target]) {
            if (e === undefined || e.Node === undefined || e.PortSide === undefined) continue
            const host = e.Node as unknown as Figure
            const slot = host.GetSideSlot?.(e, e.PortSide as ResolvedPortSide)
            if (slot === undefined) continue
            const key = `${host.Id}|${e.PortSide}`
            const arr = bySide.get(key) ?? []
            arr.push(slot.index)
            bySide.set(key, arr)
        }
    }
    const stacked: string[] = []
    for (const [key, idxs] of bySide) {
        if (new Set(idxs).size !== idxs.length) stacked.push(`${key} idxs=${JSON.stringify(idxs)}`)
    }
    expect(stacked, `sides with two connectors on the same slot: ${stacked.join(', ')}`).toEqual([])
})
