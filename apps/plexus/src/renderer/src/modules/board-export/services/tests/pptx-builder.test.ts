import { test, expect } from 'vitest'
import { buildPptx } from '../pptx-builder.js'

// A 1x1 transparent PNG data URL.
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

test('buildPptx returns a non-empty PPTX (ZIP) buffer', async () => {
  const bytes = await buildPptx(PNG_1x1, 800, 600)
  expect(bytes.length).toBeGreaterThan(0)
  // PPTX is a ZIP: first two bytes are 'PK' (0x50 0x4B).
  expect(bytes[0]).toBe(0x50)
  expect(bytes[1]).toBe(0x4b)
})
