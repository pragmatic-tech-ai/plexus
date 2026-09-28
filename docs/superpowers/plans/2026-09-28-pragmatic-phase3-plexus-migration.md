# Pragmatic Phase 3 — Sub-project 2: Plexus migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Plexus (plexus-core, devUI, plexus) to Pragmatic-only — default to Pragmatic, rewrite every Material-3 token reference to its native Pragmatic token, and stop importing Material.

**Architecture:** Bump the mural dependency to the Pragmatic-carrying `^0.56.0`, then per package (dependency order plexus-core → devUI → plexus) apply the authoritative token-map rewrite to `.mu` markup + keyed styles and the enumerated `.ts` theme-key sites, switch the two `Application` defaults, and guard each package with a zero-M3-token vitest test.

**Tech Stack:** TypeScript, mural `.mu` compiler (`compile:mu`), vitest, electron-vite.

**Spec:** [`docs/superpowers/specs/2026-09-28-pragmatic-phase3-plexus-migration-design.md`](../specs/2026-09-28-pragmatic-phase3-plexus-migration-design.md)

## Global Constraints

- **House style (binding):** Allman braces in `.ts`; OOP only (no module-level free functions/data — the guard's scan logic is `static` members of a class); no reused/user-facing inline string literals (hoist to `private static readonly` PascalCase constants); real enums; PascalCase for interfaces/public methods; test files in a `tests/` subfolder.
- **Pragmatic-only:** after migration no package imports `@pragmatic-tech-ai/mural/resources/material`; the theme switcher offers only Pragmatic Light/Dark.
- **Like-for-like:** a token swap only — no re-layout, no visual redesign, no button-`Variant` value changes (Ruling 1 in the spec), no TextBox `Variant = Plain` changes (Ruling 2).
- **Test commands:** per package `vitest run` (from the package dir); markup compile `npm run compile:mu` (plexus-core, plexus). Node built-in test is not used here — Plexus is vitest.
- **Attribution:** commit messages end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

### Token-map command (authoritative — referenced by every package task)

Apply to a package's `.mu` files, in this exact `-e` order (most-specific first; GNU sed, `@` is literal in the replacement, `\b` guards prefixes):

```bash
# usage: run from repo root; ARG is the package src dir, e.g. Plexus/packages/plexus-core/src
find "$ARG" -name '*.mu' -not -path '*/node_modules/*' -print0 | xargs -0 sed -i \
  -e 's/@OnSurfaceVariant\b/@Fg2/g' \
  -e 's/@OnSurface\b/@Fg1/g' \
  -e 's/@SurfaceContainerHigh\b/@Bg2/g' \
  -e 's/@SurfaceContainerLow\b/@Bg1/g' \
  -e 's/@SurfaceContainer\b/@Bg2/g' \
  -e 's/@Surface\b/@Bg1/g' \
  -e 's/@PrimaryContainer\b/@BrandGreenSoft/g' \
  -e 's/@OnPrimary\b/@FgOnAccent/g' \
  -e 's/@Primary\b/@ControlAccent/g' \
  -e 's/@SecondaryContainer\b/@SurfaceSelected/g' \
  -e 's/@OutlineVariant\b/@Border/g' \
  -e 's/@Outline\b/@BorderStrong/g' \
  -e 's/@Error\b/@StateDanger/g' \
  -e 's/@StateHoverOverlay\b/@RowHoverFill/g' \
  -e 's/@ShapeExtraSmall\b/@RadiusSm/g' \
  -e 's/@ShapeSmall\b/@RadiusMd/g' \
  -e 's/@ShapeFull\b/@RadiusPill/g' \
  -e 's/@BodyLarge\b/@Body/g' \
  -e 's/@BodyMedium\b/@Body/g' \
  -e 's/@BodySmall\b/@BodySm/g' \
  -e 's/@TitleMedium\b/@UiLabel/g' \
  -e 's/@TitleSmall\b/@UiLabel/g' \
  -e 's/@LabelLarge\b/@UiLabel/g' \
  -e 's/@LabelMedium\b/@UiCaption/g' \
  -e 's/@LabelSmall\b/@UiCaption/g' \
  -e 's/@Elevation2\b/@ShadowMd/g'
```

After running it over a package, review `git diff` for the package: every change must be an `@M3token → @Pragmatictoken` swap and nothing else. `@ShapeExtraSmall` defaults to `@RadiusSm`; if `git diff` shows one on a popover/menu surface, hand-set that site to `@RadiusLg`.

## Review Focus

Failure modes the ordinary suites would miss — each pinned by the per-package guard (Task 2–4) and the checks below:

1. **A missed M3 ref renders as an unresolved fallback under Pragmatic.** → the zero-M3-token guard scans the whole package tree (`.mu` `@Name` + `.ts` theme-key strings) and fails on any leftover.
2. **The dep bump didn't take** (workspace still resolves Material-only `0.55.18`) → Task 1 asserts `0.56.0` resolves and the pragmatic subpath imports.
3. **A `.ts` theme key rewritten but reactivity lost / wrong native token** → the `.ts` sites swap only the key string in the resolver call, not the mechanism; guard + `compile:mu`/render surface a bad token.
4. **`@ShapeExtraSmall` on a popover became `@RadiusSm` instead of `@RadiusLg`** → the per-package `git diff` review step checks each `@ShapeExtraSmall` site.
5. **Material still selectable** (import left behind) → guard forbids the `resources/material` import specifier in app entry files; theme switcher then lists only Pragmatic.

## File Structure

- `packages/plexus-core/package.json`, `apps/devUI/package.json`, `apps/plexus/package.json` — dep bump (Task 1).
- All `.mu` under each package `src/` — token-map rewrite (Tasks 2–4).
- `apps/devUI/src/renderer/app.mu`, `apps/plexus/src/renderer/src/app.mu` — default switch (Tasks 3, 4).
- `packages/plexus-core/src/vite/mural-renderer.ts` + `src/vite/tests/mural-renderer.test.ts` — externals (Task 2).
- `packages/plexus-core/src/renderer/modules/window-chrome/title-bar.ts` — `.ts` keys (Task 2).
- `apps/plexus/src/renderer/src/modules/**/*.ts` (code-editor, markdown/*, diagram-export/*) — `.ts` keys (Task 4).
- New guard test per package: `packages/plexus-core/src/**/tests/no-m3-tokens.test.ts`, `apps/devUI/src/**/tests/no-m3-tokens.test.ts`, `apps/plexus/src/**/tests/no-m3-tokens.test.ts` (Tasks 2–4).

---

## Task 1: Bump the mural dependency to ^0.56.0

**Files:** `packages/plexus-core/package.json`, `apps/devUI/package.json`, `apps/plexus/package.json`

**Interfaces:**
- Consumes: published `@pragmatic-tech-ai/mural@0.56.0` (SP1).
- Produces: a workspace where `import "@pragmatic-tech-ai/mural/resources/pragmatic"` resolves and registers theme `Pragmatic`.

- [ ] **Step 1: Bump every mural range**

In each of the three `package.json`s, change every `"@pragmatic-tech-ai/mural": "^0.55.x"` (both `dependencies` and `devDependencies`) to `"^0.56.0"`.

Run: `grep -rn '"@pragmatic-tech-ai/mural"' Plexus/apps/*/package.json Plexus/packages/*/package.json`
Expected: every line shows `^0.56.0`.

- [ ] **Step 2: Reinstall**

Run the repo's install (workspace root): `npm install` (from `Plexus/`).
Expected: completes; the lockfile now resolves `@pragmatic-tech-ai/mural@0.56.0`.

- [ ] **Step 3: Verify 0.56.0 + Pragmatic resolve (the delivery smoke)**

Run (from `Plexus/`):
```bash
node -p "require('@pragmatic-tech-ai/mural/package.json').version"
node --input-type=module -e "import('@pragmatic-tech-ai/mural/resources/pragmatic').then(m => { if (!('Pragmatic' in m)) process.exit(1); console.log('pragmatic subpath OK'); })"
```
Expected: `0.56.0`, then `pragmatic subpath OK`. If the version is still `0.55.x`, the bump/install didn't take — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add Plexus/apps/*/package.json Plexus/packages/*/package.json Plexus/package-lock.json
git commit -m "build(plexus): require mural ^0.56.0 (Pragmatic theme)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Migrate packages/plexus-core

**Files:** all `.mu` under `packages/plexus-core/src`; `src/vite/mural-renderer.ts` (+ its test); `src/renderer/modules/window-chrome/title-bar.ts`; new `src/renderer/modules/window-chrome/tests/no-m3-tokens.test.ts` (or a suitable existing `tests/` dir under `src`).

**Interfaces:**
- Consumes: Task 1 (mural 0.56.0).
- Produces: a Material-free plexus-core; the shared `ThemeSchemePicker`/window-chrome on native tokens; the vite externals include the pragmatic subpath.

- [ ] **Step 1: Write the zero-M3-token guard (RED)**

Create `packages/plexus-core/src/.../tests/no-m3-tokens.test.ts` (place under an existing `tests/` folder in the package's src). It scans `packages/plexus-core/src` for Material-3 tokens and fails if any remain:

```ts
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

class M3TokenScan
{
    private static readonly MuTokens: readonly string[] =
    [
        'OnSurfaceVariant', 'OnSurface', 'SurfaceContainerHigh', 'SurfaceContainerLow',
        'SurfaceContainer', 'Surface', 'PrimaryContainer', 'OnPrimary', 'Primary',
        'SecondaryContainer', 'OutlineVariant', 'Outline', 'Error', 'StateHoverOverlay',
        'ShapeExtraSmall', 'ShapeSmall', 'ShapeFull', 'BodyLarge', 'BodyMedium',
        'BodySmall', 'TitleMedium', 'TitleSmall', 'LabelLarge', 'LabelMedium',
        'LabelSmall', 'Elevation2',
    ];

    // .ts theme-key resolver call sites where an M3 name would be a live token key.
    private static readonly TsKeyContexts: readonly string[] =
    [
        'themeColor', 'bindTheme', 'Resolve', 'DynamicResource',
    ];

    private static readonly MaterialImport = 'mural/resources/material';
    private static readonly TestFile = 'no-m3-tokens.test.ts';

    // Locate this package's `src` root by walking up from this test file to the
    // nearest package.json (ESM-safe — no __dirname). Location-independent, so
    // every package's copy of this file is byte-identical.
    public static PackageSrc(fromUrl: string): string
    {
        let dir = dirname(fileURLToPath(fromUrl));
        while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
        return join(dir, 'src');
    }

    public static Walk(dir: string, out: string[]): void
    {
        for (const name of readdirSync(dir))
        {
            if (name === 'node_modules' || name === 'dist') continue;
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { M3TokenScan.Walk(p, out); continue; }
            if (p.endsWith('.mu') || (p.endsWith('.ts') && !p.endsWith(M3TokenScan.TestFile))) out.push(p);
        }
    }

    public static Offenders(fromUrl: string): string[]
    {
        const files: string[] = [];
        M3TokenScan.Walk(M3TokenScan.PackageSrc(fromUrl), files);
        const hits: string[] = [];
        for (const file of files)
        {
            const lines = readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) =>
            {
                if (line.includes(M3TokenScan.MaterialImport))
                    hits.push(`${file}:${i + 1} imports ${M3TokenScan.MaterialImport}`);
                for (const tok of M3TokenScan.MuTokens)
                {
                    if (file.endsWith('.mu') && new RegExp('@' + tok + '\\b').test(line))
                        hits.push(`${file}:${i + 1} @${tok}`);
                    if (file.endsWith('.ts')
                        && new RegExp("['\"]" + tok + "['\"]").test(line)
                        && M3TokenScan.TsKeyContexts.some(c => line.includes(c)))
                        hits.push(`${file}:${i + 1} '${tok}'`);
                }
            });
        }
        return hits;
    }
}

describe('this package carries no Material-3 tokens or Material import', () =>
{
    test('every M3 token has been migrated to a Pragmatic token', () =>
    {
        const offenders = M3TokenScan.Offenders(import.meta.url);
        expect(offenders, `Material-3 references remain:\n${offenders.join('\n')}`).toEqual([]);
    });
});
```

Place this file at `packages/plexus-core/src/vite/tests/no-m3-tokens.test.ts` (the package already has `src/vite/tests/`). It self-locates the package `src` root, so the same file is dropped verbatim into each package in Tasks 3–4.

- [ ] **Step 2: Run the guard — verify it FAILS**

Run: `cd Plexus/packages/plexus-core && npx vitest run src/vite/tests/no-m3-tokens.test.ts`
Expected: FAIL, listing the current 43 `@M3` sites + the 2 `.ts` keys.

- [ ] **Step 3: Rewrite the `.mu` tree**

Apply the Token-map command with `ARG=Plexus/packages/plexus-core/src` (from repo root). Then review `git diff Plexus/packages/plexus-core` — confirm every change is a token swap; hand-fix any `@ShapeExtraSmall` on a popover surface to `@RadiusLg`.

- [ ] **Step 4: Rewrite the `.ts` theme keys**

In `src/renderer/modules/window-chrome/title-bar.ts`: `BG_TOKEN = 'Surface'` → `'Bg1'`; `SYMBOL_TOKEN = 'OnSurfaceVariant'` → `'Fg2'`. Scan the package for any other resolver-call M3 key string and swap per the map.

- [ ] **Step 5: Update the vite externals + its test**

In `src/vite/mural-renderer.ts`, add `'@pragmatic-tech-ai/mural/resources/pragmatic'` to the returned externals array (keep the material entry — harmless). In `src/vite/tests/mural-renderer.test.ts`, add an assertion that the list contains the pragmatic subpath.

- [ ] **Step 6: Run the guard — verify it PASSES; then the suite + compile**

Run: `cd Plexus/packages/plexus-core && npx vitest run src/vite/tests/no-m3-tokens.test.ts` → Expected: PASS.
Run: `npm run compile:mu` → Expected: succeeds (all `.mu` compile; tokens resolve).
Run: `npx vitest run` → Expected: the full plexus-core suite is green.

- [ ] **Step 7: Commit**

```bash
git add Plexus/packages/plexus-core
git commit -m "feat(plexus-core): migrate to Pragmatic tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Migrate apps/devUI

**Files:** `src/renderer/app.mu` (default + imports); all `.mu` under `apps/devUI/src`; new guard test under `apps/devUI/src/**/tests/`.

**Interfaces:**
- Consumes: Task 1 (mural 0.56.0), Task 2 (plexus-core on Pragmatic).
- Produces: devUI defaulting to Pragmatic, Material-free.

- [ ] **Step 1: Write the guard (RED)**

Create `apps/devUI/src/tests/no-m3-tokens.test.ts` with the **exact same** `M3TokenScan` file from Task 2 Step 1 (it self-locates via `import.meta.url`, and already forbids the Material import and M3 tokens — no edits needed).

Run: `cd Plexus/apps/devUI && npx vitest run src/tests/no-m3-tokens.test.ts`
Expected: FAIL (16 `@M3` sites + the Material import in app.mu).

- [ ] **Step 2: Switch the Application default + imports**

In `src/renderer/app.mu`, replace:
```
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialDark from "@pragmatic-tech-ai/mural/resources/material"
```
with:
```
import Pragmatic from "@pragmatic-tech-ai/mural/resources/pragmatic"
import PragmaticDark from "@pragmatic-tech-ai/mural/resources/pragmatic"
```
and change `Application [ Theme = Material, Scheme = MaterialDark ]` → `Application [ Theme = Pragmatic, Scheme = PragmaticDark ]`.

- [ ] **Step 3: Rewrite the `.mu` tree**

Apply the Token-map command with `ARG=Plexus/apps/devUI/src`. Review `git diff Plexus/apps/devUI`; hand-fix any popover `@ShapeExtraSmall` → `@RadiusLg`. (`graph-projection.ts` keys on the `"dark"` substring of the scheme name — `PragmaticDark` matches, so no change.)

- [ ] **Step 4: Run the guard — PASS; then the suite**

Run: `cd Plexus/apps/devUI && npx vitest run src/vite/tests/no-m3-tokens.test.ts` → Expected: PASS.
Run: `npx vitest run` → Expected: the devUI suite is green.

- [ ] **Step 5: Commit**

```bash
git add Plexus/apps/devUI
git commit -m "feat(devUI): default to Pragmatic; migrate tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Migrate apps/plexus

**Files:** `src/renderer/src/app.mu` (default + imports); all `.mu` under `apps/plexus/src`; the `.ts` theme-key sites (code-editor, markdown/*, diagram-export/*); new guard test under `apps/plexus/src/**/tests/`.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: the main app defaulting to Pragmatic, Material-free.

- [ ] **Step 1: Write the guard (RED)**

Create `apps/plexus/src/renderer/src/tests/no-m3-tokens.test.ts` with the **exact same** `M3TokenScan` file from Task 2 Step 1 (self-locating; forbids the Material import and M3 tokens).

Run: `cd Plexus/apps/plexus && npx vitest run src/renderer/src/tests/no-m3-tokens.test.ts`
Expected: FAIL (365 `@M3` sites + ~21 `.ts` keys + the Material import).

- [ ] **Step 2: Switch the Application default + imports**

In `src/renderer/src/app.mu`, replace the two Material imports (lines ~28–29) with the two Pragmatic imports (as in Task 3 Step 2), and change `Application [ Theme = Material, Scheme = MaterialDark ]` → `Application [ Theme = Pragmatic, Scheme = PragmaticDark ]`.

- [ ] **Step 3: Rewrite the `.mu` tree**

Apply the Token-map command with `ARG=Plexus/apps/plexus/src`. Review `git diff` (large — spot-check that every change is a token swap); hand-fix popover `@ShapeExtraSmall` → `@RadiusLg`.

- [ ] **Step 4: Rewrite the `.ts` theme keys**

Swap the M3 key strings per the map in the resolver-call sites, scoped to these files (leave non-theme strings alone):
- `src/renderer/src/modules/code-editor/code-editor.ts` — `themeColor('Surface'|'OnSurface'|'OnSurfaceVariant'|'Primary'|'OutlineVariant'|'SurfaceContainer')` → `'Bg1'|'Fg1'|'Fg2'|'ControlAccent'|'Border'|'Bg2'`.
- `src/renderer/src/services/markdown/code-highlight.ts` — `'OnSurfaceVariant'`→`'Fg2'`, `'Primary'`→`'ControlAccent'`.
- `src/renderer/src/services/markdown/flow-style.ts`, `markdown-document.ts`, `marked-flow-renderer.ts` — `bindTheme(..., 'OnSurface'|'OnSurfaceVariant'|'SurfaceContainerHigh'|'OutlineVariant')` → `'Fg1'|'Fg2'|'Bg2'|'Border'`.
- `src/renderer/src/modules/diagram-export/services/diagram-export-service.ts` (`Resolve('Surface')`→`'Bg1'`) and `diagram-svg-renderer.ts` (`['OnSurface','OnSurfaceVariant']`→`['Fg1','Fg2']`).

- [ ] **Step 5: Run the guard — PASS; then suite + compile**

Run: `cd Plexus/apps/plexus && npx vitest run src/vite/tests/no-m3-tokens.test.ts` → Expected: PASS.
Run: `npm run compile:mu` → Expected: succeeds.
Run: `npx vitest run` → Expected: the plexus app suite is green.

- [ ] **Step 6: Commit**

```bash
git add Plexus/apps/plexus
git commit -m "feat(plexus): default to Pragmatic; migrate tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the executor

- After the last task, run the whole-branch review (most capable available model) against the spec's Review Focus, then use superpowers:finishing-a-development-branch. Base branch is `main` (Plexus repo).
- The three guard tests are near-identical `M3TokenScan` copies differing only in `m3RootFromTestDir` and (for the apps) the forbidden `resources/material` import; this repetition is intentional (each package owns its guard). If a shared helper is preferred, place it in plexus-core and import it — but keep each package's test entry so per-package RED/GREEN holds.
- No push/PR happens during execution; the integration decision is the human's at the finish gate.
