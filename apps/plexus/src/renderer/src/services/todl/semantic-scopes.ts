// The TODL LSP legend names its token types with generic scopes (`type`,
// `class`, `variable`, …). Enabling semantic highlighting exposes ALL of them to
// the base theme, which colors several — e.g. vs-dark paints `variable` and
// `property` light-blue — so instance ids and field names would go blue too, and
// the mural grammar's own `type` scope would collide. So we rename EVERY TODL
// token type to a `todl*`-namespaced scope before handing the legend to Monaco.
// Only `todlType`/`todlClass` get a (blue) theme rule; every other todl* scope
// matches no rule and falls back to the plain editor foreground — neutral. The
// token data (indices into the legend) is unchanged; only display names differ.

interface Legend { tokenTypes: string[]; tokenModifiers: string[] }

export enum TodlSemanticScope {
  Type = 'todlType',
  Class = 'todlClass',
}

// Server legend type name -> TODL-namespaced display name. Every server type is
// renamed (concept-bearing OR not) so the base theme can color none of them; the
// blue rules below opt only Type/Class back in.
const RENAME: Record<string, string> = {
  type: TodlSemanticScope.Type,
  class: TodlSemanticScope.Class,
  enumMember: 'todlEnumMember',
  property: 'todlProperty',
  method: 'todlMethod',
  variable: 'todlVariable',
}

// Any legend type not explicitly mapped still gets a todl* prefix so no generic
// scope leaks through to the base theme.
function scopeFor(serverType: string): string {
  return RENAME[serverType] ?? `todl${serverType.charAt(0).toUpperCase()}${serverType.slice(1)}`
}

export const TODL_KEYWORD_BLUE_DARK = '569CD6'
export const TODL_KEYWORD_BLUE_LIGHT = '0000FF'

export function editorSemanticLegend(server: Legend): Legend {
  return {
    tokenTypes: server.tokenTypes.map(scopeFor),
    tokenModifiers: [...server.tokenModifiers],
  }
}

export function todlSemanticThemeRules(dark: boolean): { token: string; foreground: string }[] {
  const blue = dark ? TODL_KEYWORD_BLUE_DARK : TODL_KEYWORD_BLUE_LIGHT
  return [
    { token: TodlSemanticScope.Type, foreground: blue },
    { token: TodlSemanticScope.Class, foreground: blue },
  ]
}
