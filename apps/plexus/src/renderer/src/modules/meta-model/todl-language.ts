import * as monaco from 'monaco-editor'
import { todlMonarchLanguage, todlLanguageConfiguration } from './todl-grammar.js'

// Registers the 'todl' Monaco language so .todl files get an id and syntax
// colouring. Keywords + operator glyphs are colored via the pure Monarch data
// in todl-grammar.ts; concept names arrive separately as LSP semantic tokens.
// Squiggles do NOT depend on this (diagnostics attach as markers regardless).
// Idempotent; call once from the bootstrap.

export const TODL_LANGUAGE_ID = 'todl'

let registered = false

export function registerTodlLanguage(): void
{
    if (registered) return
    registered = true

    monaco.languages.register({ id: TODL_LANGUAGE_ID })
    monaco.languages.setMonarchTokensProvider(
        TODL_LANGUAGE_ID, todlMonarchLanguage as monaco.languages.IMonarchLanguage)
    monaco.languages.setLanguageConfiguration(
        TODL_LANGUAGE_ID, todlLanguageConfiguration as monaco.languages.LanguageConfiguration)
}
