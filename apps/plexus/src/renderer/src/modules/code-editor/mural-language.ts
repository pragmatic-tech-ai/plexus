import * as monaco from 'monaco-editor'

// Registers a 'mural' Monaco language so .mu / .mural files get basic syntax
// colouring: comments, strings, @resource references, $bindings, #hex colours,
// x: directives, PascalCase element/control names, and the structural keywords.
// Deliberately small (a Monarch grammar, no language server) — richer support can
// grow later. Idempotent; call once from the bootstrap. Mirrors
// registerTodlLanguage (meta-model/todl-language.ts).

export const MURAL_LANGUAGE_ID = 'mural'

let registered = false

export function registerMuralLanguage(): void
{
    if (registered) return
    registered = true

    monaco.languages.register({ id: MURAL_LANGUAGE_ID })

    monaco.languages.setMonarchTokensProvider(MURAL_LANGUAGE_ID, {
        keywords: [
            'resources', 'module', 'import', 'merge', 'include', 'as',
            'when', 'on', 'true', 'false', 'null',
        ],
        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [/"/, 'string', '@string'],
                [/@[A-Za-z_][\w-]*/, 'variable'],            // @ResourceRef
                [/\$[A-Za-z_][\w.-]*/, 'variable'],           // $Binding path
                [/#[0-9A-Fa-f]+/, 'number'],                  // #RRGGBBAA colour
                [/\bx:[A-Za-z]+/, 'keyword'],                 // x:key / x:name / x:root
                [/[A-Z][\w-]*/, 'type'],                      // PascalCase element / control
                [/[a-z_][\w-]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
                [/\d+(\.\d+)?/, 'number'],
                [/->|=>|[:;=,.|?]/, 'operator'],
            ],
            comment: [
                [/[^/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[/*]/, 'comment'],
            ],
            string: [
                [/[^"\\]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, 'string', '@pop'],
            ],
        },
    })

    monaco.languages.setLanguageConfiguration(MURAL_LANGUAGE_ID, {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['[', ']'], ['(', ')']],
        autoClosingPairs: [
            { open: '{', close: '}' }, { open: '[', close: ']' },
            { open: '(', close: ')' }, { open: '"', close: '"' },
        ],
    })
}
