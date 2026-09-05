import { test, expect, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { DiagramExportService, ExportFormat } from '../diagram-export-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'

// The raster pipeline uses DOM Image + canvas (unavailable in the 'node' test env),
// so stub it — these tests exercise the SAVE routing, not the rasterization (the
// real PNG bytes are asserted end-to-end in the Playwright export e2e).
vi.mock('../svg-raster.js', () => ({
  rasterizeSvgToPng: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])),
  pngToDataUrl: (): string => 'data:image/png;base64,AAAA',
}))

// A minimal fake content host exposing just ActiveDocument.
function providerWith(activeDoc: unknown) {
  const provider = new ServiceProvider()
  provider.registerInstance(ContentHostService.Key, { ActiveDocument: activeDoc } as never)
  return provider
}

test('canExportActive is false when no document is active', () => {
  const svc = new DiagramExportService(providerWith(undefined))
  expect(svc.canExportActive()).toBe(false)
})

test('canExportActive is false for a non-diagram document', () => {
  const svc = new DiagramExportService(providerWith({ notADiagram: true }))
  expect(svc.canExportActive()).toBe(false)
})

test('ExportSvgCommand / ExportPptxCommand are ICommands', () => {
  const svc = new DiagramExportService(providerWith(undefined))
  expect(typeof svc.ExportSvgCommand.Execute).toBe('function')
  expect(typeof svc.ExportPptxCommand.CanExecute).toBe('function')
  expect(svc.ExportSvgCommand.CanExecute()).toBe(false) // no active diagram
})

test('exportRendered (SVG) saves the given svg via SaveFileAs with a <baseName>.svg default path', async () => {
  // The pre-rendered path shared by the active-doc commands and the explorer's
  // headless export: no active document needed — it saves the svg it's handed.
  const calls: Array<{ content: string; DefaultPath: string }> = []
  const provider = providerWith(undefined)
  provider.registerInstance(FileSystemService.Key, {
    SaveFileAs: (content: string, opts: { DefaultPath: string }) => {
      calls.push({ content, DefaultPath: opts.DefaultPath })
      return Promise.resolve(opts.DefaultPath)
    },
    WriteBytes: () => Promise.resolve(),
  } as never)

  const svc = new DiagramExportService(provider)
  await svc.exportRendered(ExportFormat.Svg, { svg: '<svg>x</svg>', width: 40, height: 30 }, 'my-flow')

  expect(calls).toHaveLength(1)
  expect(calls[0]!.content).toBe('<svg>x</svg>')
  expect(calls[0]!.DefaultPath).toBe('my-flow.svg')
})

test('exportRendered (PNG) rasterizes and writes bytes via SaveFileAs("") + WriteBytes', async () => {
  const writes: Array<{ path: string; bytes: Uint8Array }> = []
  const saveArgs: Array<{ content: string; DefaultPath: string }> = []
  const provider = providerWith(undefined)
  provider.registerInstance(FileSystemService.Key, {
    SaveFileAs: (content: string, opts: { DefaultPath: string }) => {
      saveArgs.push({ content, DefaultPath: opts.DefaultPath })
      return Promise.resolve('C:/out/diagram.png')
    },
    WriteBytes: (path: string, bytes: Uint8Array) => { writes.push({ path, bytes }); return Promise.resolve() },
  } as never)

  const svc = new DiagramExportService(provider)
  await svc.exportRendered(ExportFormat.Png, { svg: '<svg width="4" height="4"/>', width: 4, height: 4 }, 'diagram', 2)

  // PNG uses the binary two-step: empty SaveFileAs to get a path, then WriteBytes.
  expect(saveArgs).toHaveLength(1)
  expect(saveArgs[0]!.content).toBe('')
  expect(saveArgs[0]!.DefaultPath).toBe('diagram.png')
  expect(writes).toHaveLength(1)
  expect(writes[0]!.path).toBe('C:/out/diagram.png')
  expect(Array.from(writes[0]!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
})

test('OpenExportDialogCommand is present and gated by an active diagram', () => {
  const svc = new DiagramExportService(providerWith(undefined)) // no active diagram
  expect(typeof svc.OpenExportDialogCommand.Execute).toBe('function')
  expect(svc.OpenExportDialogCommand.CanExecute()).toBe(false)
})
