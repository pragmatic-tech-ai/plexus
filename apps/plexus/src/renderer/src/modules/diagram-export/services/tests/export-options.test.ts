import { describe, it, expect } from 'vitest'
import { ExportFormat, ExportBackground, DEFAULT_EXPORT_OPTIONS } from '../export-options.js'
import { ExportFormat as ReExported } from '../diagram-export-service.js'

describe('ExportOptions', () => {
  it('ExportFormat carries the three wire values', () => {
    expect(ExportFormat.Svg).toBe('svg')
    expect(ExportFormat.Png).toBe('png')
    expect(ExportFormat.Pptx).toBe('pptx')
  })
  it('ExportBackground carries its wire values', () => {
    expect(ExportBackground.Transparent).toBe('transparent')
    expect(ExportBackground.Surface).toBe('surface')
  })
  it('defaults: SVG, whole diagram, transparent, no page breaks, 2x', () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({
      format: ExportFormat.Svg,
      useSelection: false,
      background: ExportBackground.Transparent,
      showPageBreaks: false,
      scale: 2,
    })
  })
  it('the service re-exports ExportFormat for back-compat', () => {
    expect(ReExported.Png).toBe('png')
  })
})
