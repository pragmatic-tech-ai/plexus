import { describe, it, expect } from 'vitest'
import '@pragmatic-tech-ai/mural/basic'
import { DEFAULT_SYMBOLS, ENUM_MEMBERS } from '@pragmatic-tech-ai/mural/compiler'
import { MuralCompletionProvider, MuralSuggestionKind, type MuralSuggestion } from '../mural-completion-provider.js'

class Harness
{
    private static readonly Cursor = '|'
    private readonly provider = new MuralCompletionProvider()

    public At(text: string): MuralSuggestion[]
    {
        return this.provider.Suggest(text.replace(Harness.Cursor, ''), text.indexOf(Harness.Cursor))
    }
}

describe('MuralCompletionProvider.Suggest', () =>
{
    const h = new Harness()

    it('suggests DEFAULT_SYMBOLS elements in element position', () =>
    {
        const labels = h.At('Border {\n  |\n}').filter((s) => s.Kind === MuralSuggestionKind.Element).map((s) => s.Label)
        expect(DEFAULT_SYMBOLS.has('Border')).toBe(true)
        expect(labels).toContain('Border')
        expect(h.At('|').map((s) => s.Label)).toContain('Border')
    })

    it('suggests the DPs of the element in attribute position', () =>
    {
        const suggestions = h.At('Border [Width=10, |]')
        expect(suggestions.every((s) => s.Kind === MuralSuggestionKind.Property)).toBe(true)
        expect(suggestions.map((s) => s.Label)).toContain('CornerRadius')
    })

    it('suggests ENUM_MEMBERS in an enum-valued attribute', () =>
    {
        const suggestions = h.At('Border [Width=10, HorizontalAlignment=C|]')
        expect(suggestions.every((s) => s.Kind === MuralSuggestionKind.EnumMember)).toBe(true)
        const labels = suggestions.map((s) => s.Label)
        for (const member of ENUM_MEMBERS.get('HorizontalAlignment')!) expect(labels).toContain(member)
    })

    it('ignores brackets inside strings and comments', () =>
    {
        const labels = h.At('Border { // [\n  Text "]" |\n}').map((s) => s.Label)
        expect(labels).toContain('Border')
    })
})
