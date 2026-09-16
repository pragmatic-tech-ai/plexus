import { describe, it, expect, vi } from 'vitest'
import { DiagramExportPreviewModel } from '../diagram-export-preview-model.js'
import { ExportFormat, ExportBackground } from '../export-options.js'

function make(over: { hasSelection?: boolean } = {}) {
  const render = vi.fn((_o) => ({ svg: '<svg>x</svg>', width: 120, height: 80 }))
  const closed: Array<unknown> = []
  const vm = new DiagramExportPreviewModel(
    over.hasSelection ?? false, '#101014', render, (o) => closed.push(o))
  return { vm, render, closed }
}

describe('DiagramExportPreviewModel', () => {
  it('renders an initial preview and reports its size', () => {
    const { vm, render } = make()
    expect(render).toHaveBeenCalledTimes(1)
    expect(vm.Preview).toBeDefined()
    expect(vm.Preview!.Uri.startsWith('data:image/svg+xml')).toBe(true)
    expect(vm.PreviewSize).toBe('120 × 80 px')
  })

  it('defaults UseSelection to whether a selection exists', () => {
    expect(make({ hasSelection: true }).vm.UseSelection).toBe(true)
    expect(make({ hasSelection: false }).vm.UseSelection).toBe(false)
    expect(make({ hasSelection: true }).vm.HasSelection).toBe(true)
  })

  it('re-renders the preview when an option changes', () => {
    const { vm, render } = make()
    render.mockClear()
    vm.Scale = 3
    expect(render).toHaveBeenCalledTimes(1)
    vm.Format = ExportFormat.Png
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('currentOptions reflects the DP state; Surface carries the bg color', () => {
    const { vm } = make()
    vm.Format = ExportFormat.Pptx
    vm.Background = ExportBackground.Surface
    vm.ShowPageBreaks = true
    vm.Scale = 1
    const o = vm.currentOptions()
    expect(o).toMatchObject({
      format: ExportFormat.Pptx, background: ExportBackground.Surface,
      backgroundColor: '#101014', showPageBreaks: true, scale: 1,
    })
  })

  it('Transparent omits the background color', () => {
    const { vm } = make()
    vm.Background = ExportBackground.Transparent
    expect(vm.currentOptions().backgroundColor).toBeUndefined()
  })

  it('ForegroundChoice maps to an ink hex; Default leaves it as-is', () => {
    const { vm } = make()
    expect(vm.currentOptions().foreground).toBeUndefined() // Default
    vm.ForegroundChoice = 'Black'
    expect(vm.currentOptions().foreground).toBe('#000000')
    vm.ForegroundChoice = 'White'
    expect(vm.currentOptions().foreground).toBe('#ffffff')
  })

  it('exposes the ComboBox item lists as observable collections', () => {
    const { vm } = make()
    expect(vm.Formats!.ToArray()).toEqual([ExportFormat.Svg, ExportFormat.Png, ExportFormat.Pptx])
    expect(vm.Backgrounds!.ToArray()).toEqual([ExportBackground.Transparent, ExportBackground.Surface])
    expect(vm.Scales!.ToArray()).toEqual([1, 2, 3])
    expect(vm.ForegroundChoices!.ToArray()).toEqual(['Default', 'Black', 'White'])
  })

  it('preselects the default option values', () => {
    const { vm } = make()
    expect(vm.Format).toBe(ExportFormat.Svg)
    expect(vm.Background).toBe(ExportBackground.Transparent)
    expect(vm.Scale).toBe(2)
    expect(vm.ForegroundChoice).toBe('Default')
  })

  it('ExportCommand closes with the resolved options; CancelCommand closes with undefined', () => {
    const { vm, closed } = make()
    vm.Format = ExportFormat.Png
    vm.ExportCommand.Execute(undefined)
    expect((closed[0] as { format: string }).format).toBe('png')

    const c2 = make()
    c2.vm.CancelCommand.Execute(undefined)
    expect(c2.closed[0]).toBeUndefined()
  })
})
