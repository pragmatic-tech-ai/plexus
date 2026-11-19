import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { BoardExportFormat } from '@pragmatic-tech-ai/plexus-core/renderer/projects'

import { BoardHeadlessRenderer } from '../board-headless-renderer.js'
import { BoardExportService } from '../board-export-service.js'
import { ExportFormat } from '../export-options.js'
import { BoardTreeExport } from '../board-tree-export.js'

type SaveCall = { format: ExportFormat; name: string }

function providerWith(rendered: unknown): { provider: ServiceProvider; calls: SaveCall[] }
{
    const provider = new ServiceProvider()
    const calls: SaveCall[] = []
    provider.registerInstance(BoardHeadlessRenderer.Key, { renderFile: async () => rendered } as never)
    provider.registerInstance(BoardExportService.Key, {
        exportRendered: async (format: ExportFormat, _r: unknown, name: string) => { calls.push({ format, name }) },
    } as never)
    return { provider, calls }
}

const OP = {} as never

test('Export renders the node and saves via the pipeline (svg → ExportFormat.Svg, basename)', async () => {
    const { provider, calls } = providerWith({ svg: '<svg/>', width: 1, height: 1 })
    await new BoardTreeExport(provider).Export(OP, 'sub/flow.board', BoardExportFormat.Svg)
    expect(calls).toEqual([{ format: ExportFormat.Svg, name: 'flow' }])
})

test('Export maps pptx → ExportFormat.Pptx', async () => {
    const { provider, calls } = providerWith({ svg: '', width: 1, height: 1 })
    await new BoardTreeExport(provider).Export(OP, 'a.board', BoardExportFormat.Pptx)
    expect(calls[0]!.format).toBe(ExportFormat.Pptx)
})

test('Export short-circuits when the render is empty (nothing saved)', async () => {
    const { provider, calls } = providerWith(undefined)
    await new BoardTreeExport(provider).Export(OP, 'a.board', BoardExportFormat.Svg)
    expect(calls).toEqual([])
})
