# Pragmatic theme — Phase 3, Sub-project 2: Plexus migration — design

**Status:** approved design, pre-plan.
**Parent spec:** `Mural/docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md`
(§ App migration, § Phases — step 3).
**Sub-project 1 (delivered):** `Mural/docs/superpowers/specs/2026-09-28-pragmatic-phase3-mural-delivery-design.md`
— `@pragmatic-tech-ai/mural@0.56.0` is published with the Pragmatic theme.
**Repo:** Plexus (`apps/plexus`, `apps/devUI`, `packages/plexus-core`).

## Context

The Pragmatic theme is complete in Mural (Foundation + template Waves 1–5) and
now consumable: importing `@pragmatic-tech-ai/mural/resources/pragmatic`
registers theme `Pragmatic` with schemes `PragmaticLight`/`PragmaticDark`, and
`mural@0.56.0` ships it. Phase 3 was decomposed by repo; this is sub-project 2,
migrating the Plexus consumer. Sub-project 3 (TODL) follows.

Plexus currently defaults to Material (`Application [Theme = Material,
Scheme = MaterialDark]` in both apps) and references Material-3 tokens directly
in ~400 `.mu` sites and ~23 `.ts` string sites. Plexus offers runtime theme
switching (devUI's shell `ThemeSelector`; plexus-core's `ThemeSchemePicker`,
which hosts the framework `ThemeSelector`).

## Goal

Migrate Plexus to **Pragmatic-only**: default to Pragmatic, rewrite every
Material-3 token reference (markup and code) to its native Pragmatic token, and
stop importing Material so the theme switcher offers only Pragmatic Light/Dark.
Leave the app visually on the brand theme with no unresolved tokens.

## Decisions (settled at brainstorming)

- **Drop Material from Plexus.** The app commits to Pragmatic; Material is no
  longer imported or selectable in Plexus. (Mural still ships Material until
  Phase 4; this is the app-side commitment.) Rewriting refs to native tokens is
  therefore safe — there is no Material scheme left for them to break under.
- **One plan, by package**, migrated in dependency order:
  `packages/plexus-core` → `apps/devUI` → `apps/plexus`. Single review at the end.
- **Verification = green suites + a zero-M3-token guard** (below).

## Non-goals

- No changes to Mural (no new tokens, no Material removal — that is Phase 4).
- **No button-`Variant` reconciliation** (see Ruling 1).
- No TextBox `Variant = Plain` changes (see Ruling 2).
- No visual redesign, no re-layout — a like-for-like token swap only.
- No TODL changes (sub-project 3).

## The token map (authoritative for this migration)

Every Material-3 token that appears in Plexus, with its native Pragmatic target.
Applied identically to `.mu` attribute values and to `.ts` theme-key strings
(the string form drops the `@`, e.g. `'OnSurfaceVariant'` → `'Fg2'`).

**Colour**

| Material-3 | Pragmatic | Notes |
|---|---|---|
| `@OnSurface` | `@Fg1` | primary ink (80×) |
| `@OnSurfaceVariant` | `@Fg2` | muted ink (154×) |
| `@Surface` | `@Bg1` | base surface |
| `@SurfaceContainerLow` | `@Bg1` | |
| `@SurfaceContainer` | `@Bg2` | raised surface |
| `@SurfaceContainerHigh` | `@Bg2` | raised surface |
| `@Primary` | `@ControlAccent` | interactive accent (matches control forks) |
| `@OnPrimary` | `@FgOnAccent` | ink on accent |
| `@PrimaryContainer` | `@BrandGreenSoft` | soft brand fill |
| `@SecondaryContainer` | `@SurfaceSelected` | selected-row fill |
| `@Outline` | `@BorderStrong` | strong border |
| `@OutlineVariant` | `@Border` | subtle border |
| `@Error` | `@StateDanger` | error/danger |
| `@StateHoverOverlay` | `@RowHoverFill` | row hover |

**Radius**

| Material-3 | Pragmatic |
|---|---|
| `@ShapeExtraSmall` | `@RadiusSm` |
| `@ShapeSmall` | `@RadiusMd` |
| `@ShapeFull` | `@RadiusPill` |

**Type styles** (used as `Style = @X`; Pragmatic style keys are
`Display1/2`, `H1–H4`, `Body`, `BodySm`, `BodySerif`, `UiLabel`, `UiLabelSm`,
`UiCaption`, `Code`, `Label`)

| Material-3 | Pragmatic |
|---|---|
| `@BodyLarge` | `@Body` |
| `@BodyMedium` | `@Body` |
| `@BodySmall` | `@BodySm` |
| `@TitleMedium` | `@UiLabel` |
| `@TitleSmall` | `@UiLabel` |
| `@LabelLarge` | `@UiLabel` |
| `@LabelMedium` | `@UiCaption` |
| `@LabelSmall` | `@UiCaption` |

**Effect**

| Material-3 | Pragmatic |
|---|---|
| `@Elevation2` | `@ShadowMd` |

If the migration surfaces a Material-3 token not in this table, it is added to
the table with its native target (recorded as a ruling), never left unmapped.
`@ShapeExtraSmall` defaults to `@RadiusSm`; a site that is clearly a popover/menu
surface uses `@RadiusLg` (per the canonical Pragmatic popover) — a per-site
judgment, few if any in app markup.

## Deliverables (per package)

Order: `plexus-core` → `devUI` → `plexus`. Each package is self-checking (its
own `vitest run` green + no M3 tokens remain in it) before the next.

### D-common — dependency bump

Bump `@pragmatic-tech-ai/mural` from `^0.55.18` to `^0.56.0` in every
`package.json` that names it (`apps/plexus`, `apps/devUI`,
`packages/plexus-core` — dependencies and devDependencies), then reinstall so
the workspace resolves `0.56.0`. `^0.55.18` does **not** admit `0.56.0`
(caret on `0.x`), so this gates everything.

### D1 — packages/plexus-core (43 `.mu` refs + 2 `.ts` keys)

- Rewrite all M3 token refs in `.mu` per the map.
- Rewrite the `.ts` string keys in `window-chrome/title-bar.ts`
  (`BG_TOKEN = 'Surface'` → `'Bg1'`, `SYMBOL_TOKEN = 'OnSurfaceVariant'` →
  `'Fg2'`) and any other `.ts` theme-key string.
- Update the vite `mural-renderer` externals list
  (`src/vite/mural-renderer.ts`) to include
  `@pragmatic-tech-ai/mural/resources/pragmatic` (alongside or in place of the
  material subpath). Update its test (`src/vite/tests/mural-renderer.test.ts`)
  accordingly.
- App-local keyed styles referencing M3 tokens (e.g. window-chrome) → native.

### D2 — apps/devUI (16 `.mu` refs, 1 default)

- Switch `src/renderer/app.mu`: remove the two Material imports (lines 12–13),
  add `import Pragmatic from "@pragmatic-tech-ai/mural/resources/pragmatic"`,
  change line 54 to `Application [ Theme = Pragmatic, Scheme = PragmaticDark ]`.
- Rewrite the 16 `.mu` token refs per the map.
- `graph-projection.ts` reads `ThemeManager.ActiveScheme?.name` — confirm it
  branches on scheme *name*; update any `'MaterialDark'`/`'MaterialLight'`
  literal to the Pragmatic scheme names if present.

### D3 — apps/plexus (365 `.mu` refs, 1 default, ~21 `.ts` keys)

- Switch `src/renderer/src/app.mu`: remove Material imports (lines 28–29), add
  the Pragmatic import, change line 248 to
  `Application [ Theme = Pragmatic, Scheme = PragmaticDark ]`.
- Rewrite all `.mu` token refs per the map.
- Rewrite `.ts` string-key sites per the map: `code-editor.ts` (`themeColor`),
  `markdown/*.ts` (`bindTheme`, `code-highlight` maps), `diagram-export/*.ts`
  (`Resolve`, `THEME_STROKE`-style arrays). Preserve theme-reactivity: these
  keys still resolve through the active (Pragmatic) scheme.
- App-local keyed styles referencing M3 (e.g. `ToolMonoBox`, rails) → native.

### D4 — zero-M3-token guard

A committed vitest test (one per app, or one shared in plexus-core that scans
all three source trees) that scans `src/**/*.{mu,ts}` (excluding `node_modules`,
`dist`, and this test) and asserts **no** Material-3 token name remains. Two
match modes to stay precise:

- **`.mu`:** match `@Name` for the exact set of keys in the map's left column.
  The `@` prefix + PascalCase makes these unambiguous.
- **`.ts`:** the map's left column includes ordinary words (`'Surface'`,
  `'Primary'`, `'Error'`, `'Outline'`) that would false-positive as bare
  strings, so the `.ts` scan is scoped to theme-resolution contexts — the
  string argument of the known resolver call sites (`themeColor(...)`,
  `bindTheme(..., 'X')`, `Resolve('X')`, `DynamicResource(..., 'X')`) and the
  theme-key maps/arrays (`code-highlight`, diagram `THEME_LINK`-style arrays,
  `BG_TOKEN`/`SYMBOL_TOKEN` constants) — not every occurrence of the word.

Any hit fails with the file:line, so a missed reference (which would render as an
unresolved fallback under Pragmatic) is caught mechanically rather than visually.
An explicit allowlist entry (with a reason) is permitted only for a genuine
non-theme use of one of these words; the migration should produce none.

## Rulings (resolving parent-spec conflicts, recorded here)

1. **No button-`Variant` reconciliation.** The parent spec calls for rewriting
   ~60 `Variant` call sites (Text→Ghost, Filled→Primary, …). The Wave-1
   Pragmatic Button template already maps the M3 legacy names onto its four
   templates (`Filled/Primary/Elevated`→Primary, `Tonal/Outlined`→Secondary,
   `Text/Standard`→Ghost, `Danger`→Danger) — documented in
   `Mural/src/framework/pragmatic/buttons/buttons.template.mu` as "no app/demo
   call-site changes." Rewriting the values is therefore unnecessary churn; the
   variants render correctly as-is. *Cost if wrong:* buttons render with the
   wrong emphasis — caught by the render/manual check; a follow-up rename pass
   is cheap.
2. **`TextBox Variant = Plain` stays.** The five `Variant = Plain` sites are
   TextBoxes, not Buttons; the Pragmatic TextBox fork supports `Plain`. Not
   part of the button-variant question, no change.

## Verification / Testing

- `vitest run` green in each of `packages/plexus-core`, `apps/devUI`,
  `apps/plexus` (existing suites must stay green after migration).
- The D4 zero-M3-token guard passes (no M3 tokens remain).
- `compile:mu` succeeds for `plexus-core` and `plexus` (a rewritten ref that
  doesn't resolve would surface here or at render).
- No `@pragmatic-tech-ai/mural@0.55.x` left in any lockfile entry for the three
  packages (the bump took effect).

## Interfaces / contract (for sub-project 3, TODL)

- Import specifier `@pragmatic-tech-ai/mural/resources/pragmatic`; theme
  `Pragmatic`; schemes `PragmaticLight`/`PragmaticDark`; the token map above is
  the shared migration table TODL reuses.

## Risks & mitigations

- **A missed M3 ref renders as an unresolved fallback.** Mitigated by the D4
  guard (mechanical, whole-tree) plus green suites.
- **`^0.56.0` not installed** → the app still resolves the old Material-only
  `0.55.18` and Pragmatic imports fail. Mitigated by D-common first and the
  lockfile check in Verification.
- **A `.ts` theme key rewritten to a token the Pragmatic scheme lacks.** The map
  targets are all verified present in the Pragmatic catalog; the guard forbids
  leftover M3 names, and `compile:mu`/render surfaces a bad native token.
- **`@ShapeExtraSmall` radius ambiguity** (chip vs popover). Default `@RadiusSm`;
  per-site `@RadiusLg` only for popover surfaces — few in app markup, decided at
  the site.
- **Scope of `.ts` theme-reactivity.** The string-key sites must keep resolving
  through the active scheme (not hardcode a colour); the map preserves that by
  swapping the key, not the mechanism.

## Out of scope / follow-ups

- TODL migration (sub-project 3).
- Material removal from Mural + Mural demo/test migration (Phase 4).
- Any button-`Variant` value rename (cosmetic; not required — Ruling 1).
