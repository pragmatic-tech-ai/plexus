// Pure, monaco-free Monarch grammar DATA for the 'todl' language. Kept free of
// any `monaco-editor` import so it is unit-testable in the node vitest env; the
// registration glue (todl-language.ts) casts these POJOs to the monaco types.
//
// Two things earn the keyword-blue scope: the fixed keyword set below, and any
// operator GLYPH — a run of edge characters (`- ~ = > < !`). Operator glyphs are
// author-defined per meta-model (todl 0.28.0+), but every glyph is lexically a
// run of those characters, so the grammar colors them without knowing the
// declared set. Concept names are NOT here — they are meta-model-derived and
// arrive via LSP semantic tokens.

export const TODL_KEYWORDS: string[] = [
  'namespace', 'import', 'package', 'primitive', 'concept', 'taxonomy', 'viewpoint',
  'annotation', 'annotate', 'model', 'operator', 'relationship', 'invariant', 'term',
  'class', 'internal', 'sealed', 'extends', 'represents', 'frames', 'uses', 'conforms',
  'instanceof', 'authoring', 'true', 'false',
]

// A C-like identifier: leading letter/underscore, then word chars. No kebab `-`.
export const TODL_IDENTIFIER_PATTERN = /[A-Za-z_]\w*/

// An operator glyph: a run of 2+ edge characters (covers `->`, `-->`, `==>`,
// `~>`, `->>`, `==`, `!=`). A lone `=` (assignment) has length 1 and is left to
// the delimiter rule, so it stays neutral.
export const TODL_OPERATOR_PATTERN = /[-~=<>!]{2,}/

export const todlMonarchLanguage = {
  keywords: TODL_KEYWORDS,
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"""/, 'string', '@rawstring'],
      [/"/, 'string', '@string'],
      [TODL_IDENTIFIER_PATTERN, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/\d+/, 'number'],
      [TODL_OPERATOR_PATTERN, 'keyword'],
      [/[{}()[\]]/, '@brackets'],
      [/[:;,.=|?*+&]/, 'delimiter'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    string: [
      [/[^"]+/, 'string'],
      [/"/, 'string', '@pop'],
    ],
    rawstring: [
      [/"""/, 'string', '@pop'],
      [/[^"]+/, 'string'],
      [/"/, 'string'],
    ],
  },
}

export const todlLanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' }, { open: '[', close: ']' },
    { open: '(', close: ')' }, { open: '"', close: '"' },
  ],
}
