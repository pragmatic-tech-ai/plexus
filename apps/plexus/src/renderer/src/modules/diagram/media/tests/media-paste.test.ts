import { describe, it, expect } from 'vitest'
import { pasteItemsFromClipboard } from '../media-drop-handler'

function clipboardWith(file: File): DataTransfer {
    return {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
    } as unknown as DataTransfer
}

describe('pasteItemsFromClipboard', () => {
    it('extracts an image file from clipboard items', () => {
        const file = new File([new Uint8Array([1])], 'pasted.png', { type: 'image/png' })
        const items = pasteItemsFromClipboard(clipboardWith(file))
        expect(items).toHaveLength(1)
        expect(items[0].file?.name).toBe('pasted.png')
    })
    it('ignores non-file clipboard entries', () => {
        const dt = { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } as unknown as DataTransfer
        expect(pasteItemsFromClipboard(dt)).toHaveLength(0)
    })
})
