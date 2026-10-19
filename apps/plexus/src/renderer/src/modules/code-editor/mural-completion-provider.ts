import type * as monaco from 'monaco-editor'
import { DEFAULT_SYMBOLS, ENUM_MEMBERS, DEFAULT_SLOT_INFO } from '@pragmatic-tech-ai/mural/compiler'
import { MuralBase } from '@pragmatic-tech-ai/mural/runtime'

export enum MuralSuggestionKind
{
    Element = 'element',
    Property = 'property',
    EnumMember = 'enum-member',
}

export interface MuralSuggestion
{
    readonly Label: string
    readonly Kind: MuralSuggestionKind
    readonly Detail: string
}

interface OpenScope
{
    readonly Opener: string
    readonly Offset: number
}

// Completion for .mu (Mural markup), built on the mural compiler's symbol catalogue.
// Context is found by a tolerant bracket scan of the text before the cursor (the buffer
// is usually unparseable mid-typing, so a full parse is not relied on): inside `[ ... ]`
// the cursor is in attribute-name position (DPs of the owning element via
// MuralBase.EnumerateProperties) or, after `Name =`, in value position (enum members);
// anywhere else (top level or a `{ ... }` body) it is element position. Suggest() is pure;
// provideCompletionItems is the thin Monaco wrapper.
export class MuralCompletionProvider implements monaco.languages.CompletionItemProvider
{
    private static readonly ModulePrefix = '@pragmatic-tech-ai/mural/'
    private static readonly ValuePattern = /([A-Za-z_]\w*)\s*=\s*[\w.]*$/
    private static readonly HeadPattern = /([A-Za-z_][\w.]*)\s*$/
    private static readonly Uppercase = /^[A-Z]/
    private static readonly SlotSuffix = ':'
    private static readonly SlotLabel = ' slot'
    private static readonly DetailSeparator = '.'
    private static readonly StringSlotKind = 'string'
    private static readonly Quote = '"'
    private static readonly Escape = '\\'
    private static readonly LineCommentStart = '//'
    private static readonly BlockCommentStart = '/*'
    private static readonly BlockCommentEnd = '*/'
    private static readonly Newline = '\n'
    private static readonly Openers = '[{('
    private static readonly Closers = ']})'
    private static readonly SquareOpen = '['
    private static readonly CurlyOpen = '{'
    private static readonly KindClass = 5
    private static readonly KindProperty = 9
    private static readonly KindEnumMember = 16

    public readonly triggerCharacters = ['[', ',', '=']

    public Suggest(source: string, offset: number): MuralSuggestion[]
    {
        const scan = MuralCompletionProvider.Scan(source, offset)
        if (scan.InLiteral) return []
        const scope = scan.Scope
        if (scope === null || scope.Opener === MuralCompletionProvider.CurlyOpen)
        {
            return MuralCompletionProvider.ElementSuggestions(source, scope)
        }
        if (scope.Opener !== MuralCompletionProvider.SquareOpen) return []

        const inside = source.slice(scope.Offset + 1, offset)
        const value = MuralCompletionProvider.ValuePattern.exec(inside)
        if (value !== null) return MuralCompletionProvider.EnumSuggestions(value[1])
        return MuralCompletionProvider.AttributeSuggestions(MuralCompletionProvider.HeadName(source, scope.Offset))
    }

    public provideCompletionItems(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList>
    {
        const word = model.getWordUntilPosition(position)
        const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
        }
        const suggestions = this.Suggest(model.getValue(), model.getOffsetAt(position))
        return { suggestions: suggestions.map((s) => MuralCompletionProvider.ToItem(s, range)) }
    }

    private static ToItem(s: MuralSuggestion, range: monaco.IRange): monaco.languages.CompletionItem
    {
        return { label: s.Label, kind: MuralCompletionProvider.MonacoKind(s.Kind), detail: s.Detail, insertText: s.Label, range }
    }

    // Monaco CompletionItemKind values (a type-only monaco import keeps this unit-testable).
    private static MonacoKind(kind: MuralSuggestionKind): monaco.languages.CompletionItemKind
    {
        switch (kind)
        {
            case MuralSuggestionKind.Element: return MuralCompletionProvider.KindClass
            case MuralSuggestionKind.Property: return MuralCompletionProvider.KindProperty
            default: return MuralCompletionProvider.KindEnumMember
        }
    }

    private static ElementSuggestions(source: string, scope: OpenScope | null): MuralSuggestion[]
    {
        const out: MuralSuggestion[] = []
        for (const [name, module] of DEFAULT_SYMBOLS)
        {
            if (!MuralCompletionProvider.Uppercase.test(name)) continue
            out.push({
                Label: name,
                Kind: MuralSuggestionKind.Element,
                Detail: module.replace(MuralCompletionProvider.ModulePrefix, ''),
            })
        }
        if (scope !== null)
        {
            const slot = DEFAULT_SLOT_INFO.get(MuralCompletionProvider.HeadName(source, scope.Offset))
            if (slot !== undefined && slot.kind !== MuralCompletionProvider.StringSlotKind)
            {
                out.unshift({
                    Label: slot.name + MuralCompletionProvider.SlotSuffix,
                    Kind: MuralSuggestionKind.Property,
                    Detail: slot.name + MuralCompletionProvider.SlotLabel,
                })
            }
        }
        return out
    }

    private static AttributeSuggestions(element: string): MuralSuggestion[]
    {
        const klass = MuralBase.find_class(element)
        if (klass === undefined) return []
        return MuralBase.EnumerateProperties(klass).map((d) => ({
            Label: d.Name,
            Kind: MuralSuggestionKind.Property,
            Detail: (d.RootOwner?.name ?? d.Owner?.name ?? element) + MuralCompletionProvider.DetailSeparator + d.Name,
        }))
    }

    private static EnumSuggestions(property: string): MuralSuggestion[]
    {
        const enumNames = ENUM_MEMBERS.has(property) ? [property] : []
        const out: MuralSuggestion[] = []
        for (const enumName of enumNames)
        {
            for (const member of ENUM_MEMBERS.get(enumName) ?? [])
            {
                out.push({ Label: member, Kind: MuralSuggestionKind.EnumMember, Detail: enumName })
            }
        }
        return out
    }

    // Name of the element heading the scope opened at `openerOffset` (`Border [` / `Border {`).
    private static HeadName(source: string, openerOffset: number): string
    {
        const m = MuralCompletionProvider.HeadPattern.exec(source.slice(0, openerOffset))
        return m === null ? '' : m[1]
    }

    // Innermost unclosed bracket before `offset`, skipping strings and comments; also
    // reports whether `offset` itself sits inside an unterminated string or comment.
    private static Scan(source: string, offset: number): { Scope: OpenScope | null; InLiteral: boolean }
    {
        const stack: OpenScope[] = []
        let i = 0
        while (i < offset)
        {
            const c = source[i]
            if (c === MuralCompletionProvider.Quote)
            {
                i++
                while (i < offset && source[i] !== MuralCompletionProvider.Quote)
                {
                    i += source[i] === MuralCompletionProvider.Escape ? 2 : 1
                }
                if (i >= offset) return { Scope: null, InLiteral: true }
                i++
                continue
            }
            if (source.startsWith(MuralCompletionProvider.LineCommentStart, i))
            {
                const end = source.indexOf(MuralCompletionProvider.Newline, i)
                if (end < 0 || end >= offset) return { Scope: null, InLiteral: true }
                i = end
                continue
            }
            if (source.startsWith(MuralCompletionProvider.BlockCommentStart, i))
            {
                const end = source.indexOf(MuralCompletionProvider.BlockCommentEnd, i + 2)
                if (end < 0 || end + 2 > offset) return { Scope: null, InLiteral: true }
                i = end + 2
                continue
            }
            if (MuralCompletionProvider.Openers.includes(c)) stack.push({ Opener: c, Offset: i })
            else if (MuralCompletionProvider.Closers.includes(c)) stack.pop()
            i++
        }
        return { Scope: stack.length === 0 ? null : stack[stack.length - 1], InLiteral: false }
    }
}
