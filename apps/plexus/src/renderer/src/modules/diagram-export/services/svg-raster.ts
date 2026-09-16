// Rasterize an SVG string to PNG bytes at `scale`× for crisp output. Renderer-only
// (uses the DOM Image + canvas). Rejects if the SVG fails to load.
export async function rasterizeSvgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array>
{
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('failed to rasterize SVG'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob: Blob = await new Promise<Blob>((res, reject) =>
    canvas.toBlob((b) => b ? res(b) : reject(new Error('canvas.toBlob returned null')), 'image/png')
  )
  return new Uint8Array(await blob.arrayBuffer())
}

// Convenience: PNG bytes → data URL (pptxgenjs addImage wants a data URI).
export function pngToDataUrl(bytes: Uint8Array): string
{
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'data:image/png;base64,' + btoa(bin)
}
