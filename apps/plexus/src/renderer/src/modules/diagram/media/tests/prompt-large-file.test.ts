import { describe, it, expect, vi } from 'vitest'
import { LargeFileChoice } from '../media-storage'
import { makeLargeFilePrompt } from '../prompt-large-file'

describe('makeLargeFilePrompt', () => {
    it('maps a confirmed dialog to Embed', async () => {
        const dialogs = { Show: vi.fn(async () => true), Close: vi.fn() } as never
        const prompt = makeLargeFilePrompt(dialogs)
        expect(await prompt('big.pdf')).toBe(LargeFileChoice.Embed)
        expect((dialogs as { Show: ReturnType<typeof vi.fn> }).Show).toHaveBeenCalledOnce()
    })
    it('maps a dismissed/cancelled dialog to Link', async () => {
        const dialogs = { Show: vi.fn(async () => undefined), Close: vi.fn() } as never
        expect(await makeLargeFilePrompt(dialogs)('big.pdf')).toBe(LargeFileChoice.Link)
    })
    it('defaults to Embed when there is no dialog service (headless/tests)', async () => {
        expect(await makeLargeFilePrompt(undefined)('big.pdf')).toBe(LargeFileChoice.Embed)
    })
})
