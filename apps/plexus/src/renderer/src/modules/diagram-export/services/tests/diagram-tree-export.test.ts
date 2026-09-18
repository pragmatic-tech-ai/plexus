import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DiagramExportFormat } from '@pragmatic-tech-ai/plexus-core/renderer/projects'

import { DiagramHeadlessRenderer } from '../diagram-headless-renderer.js'
import { DiagramExportService } from '../diagram-export-service.js'
import { ExportFormat } from '../export-options.js'
import { DiagramTreeExport } from '../diagram-tree-export.js'

type SaveCall = { format: ExportFormat; name: string }

function providerWith(rendered: unknown): { provider: ServiceProvider; calls: SaveCall[] }
{
    const provider = new ServiceProvider()
    const calls: SaveCall[] = []
    provider.registerInstance(DiagramHeadlessRenderer.Key, { renderFile: async () => rendered } as never)
    provider.registerInstance(DiagramExportService.Key, {
        exportRendered: async (format: ExportFormat, _r: unknown, name: string) => { calls.push({ format, name }) },
    } as never)
    return { provider, calls }
}

const OP = {} as never

test('Export renders the node and saves via the pipeline (svg → ExportFormat.Svg, basename)', async () => {
    const { provider, calls } = providerWith({ svg: '<svg/>', width: 1, height: 1 })
    await new DiagramTreeExport(provider).Export(OP, 'sub/flow.diagram', DiagramExportFormat.Svg)
    expect(calls).toEqual([{ format: ExportFormat.Svg, name: 'flow' }])
})

test('Export maps pptx → ExportFormat.Pptx', async () => {
    const { provider, calls } = providerWith({ svg: '', width: 1, height: 1 })
    await new DiagramTreeExport(provider).Export(OP, 'a.diagram', DiagramExportFormat.Pptx)
    expect(calls[0]!.format).toBe(ExportFormat.Pptx)
})

test('Export short-circuits when the render is empty (nothing saved)', async () => {
    const { provider, calls } = providerWith(undefined)
    await new DiagramTreeExport(provider).Export(OP, 'a.diagram', DiagramExportFormat.Svg)
    expect(calls).toEqual([])
})
