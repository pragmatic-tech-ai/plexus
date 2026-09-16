import PptxGenJS from 'pptxgenjs'

// One slide sized to the diagram's aspect, the diagram PNG filling it (with a
// small margin). Returns the .pptx as bytes.
export async function buildPptx(pngDataUrl: string, widthPx: number, heightPx: number): Promise<Uint8Array>
{
  const pptx = new PptxGenJS()
  // Slide in inches at 96 DPI; keep the diagram aspect, cap to a 10x7.5in slide.
  const inW = widthPx / 96, inH = heightPx / 96
  const scale = Math.min(10 / inW, 7.5 / inH, 1)
  const w = inW * scale, h = inH * scale
  pptx.defineLayout({ name: 'DIAGRAM', width: Math.max(w, 1), height: Math.max(h, 1) })
  pptx.layout = 'DIAGRAM'
  const slide = pptx.addSlide()
  slide.addImage({ data: pngDataUrl, x: 0, y: 0, w: Math.max(w, 1), h: Math.max(h, 1) })
  const out = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  return new Uint8Array(out)
}
