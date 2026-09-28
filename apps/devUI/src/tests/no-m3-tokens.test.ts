import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Scheme-membership guard. After the Pragmatic migration no .mu markup and no .ts
// theme-key resolver call may reference a Material token that Pragmatic does not
// also define, and nothing may import Mural's Material resource bundle.
//
// The forbidden set is DERIVED, not hand-listed: it is the Material theme's own
// vocabulary (its token catalog plus every scheme's token map) minus the Pragmatic
// vocabulary. So it stays exhaustive as Material evolves -- the tokens an earlier
// hand-maintained denylist missed (state layers, type-scale scalars, @DiagramCanvas)
// all live in Material's catalog -- and it never flags an app-local x:key, an icon
// geometry, or a cross-package resource key, because those are not Material tokens.
// The single token both themes define (@Scrim) is excluded by the Pragmatic subtraction.
//
// The vocabulary is computed in a CLEAN Node child process, not imported here:
// vitest forces Node's `development` condition, which resolves Mural's theme bundles
// to their unbuilt .ts under node_modules and crashes vitest's transform. The child
// runs with default conditions, so it loads Mural's dist cleanly (same tactic the
// Mural delivery guard uses); this test process only scans files.
class SchemeMembershipScan
{
    private static readonly MaterialImport = 'mural/resources/material';
    private static readonly TestFile = 'no-m3-tokens.test.ts';

    // .ts theme-key resolver call sites where a bare token name is a live key.
    private static readonly TsKeyContexts: readonly string[] =
    [
        'themeColor', 'bindTheme', 'Resolve', 'DynamicResource',
    ];

    // Imports both bundles (registering them by side effect), then prints the
    // Material-minus-Pragmatic vocabulary as JSON. Run under default conditions.
    private static readonly VocabScript =
        'import "@pragmatic-tech-ai/mural/resources/material";'
        + 'import "@pragmatic-tech-ai/mural/resources/pragmatic";'
        + 'import { ThemeManager } from "@pragmatic-tech-ai/mural/visual-engine";'
        + 'const v = (n) => { const t = ThemeManager.GetTheme(n); const s = new Set();'
        + ' if (!t) return s; for (const k of t.catalog.keys()) s.add(k);'
        + ' for (const sc of t.schemes.values()) for (const k of sc.tokens.keys()) s.add(k); return s; };'
        + 'const M = v("Material"), P = v("Pragmatic");'
        + 'process.stdout.write(JSON.stringify([...M].filter(t => !P.has(t))));';

    // Material tokens Pragmatic does not define -- what must not appear under Pragmatic.
    // Derived in a clean Node child rooted at this package (so bare Mural specifiers resolve).
    public static ForbiddenTokens(fromUrl: string): Set<string>
    {
        const pkgRoot = dirname(SchemeMembershipScan.PackageSrc(fromUrl));
        const json = execFileSync('node', ['--input-type=module', '-e', SchemeMembershipScan.VocabScript],
            { cwd: pkgRoot, encoding: 'utf8' });
        return new Set(JSON.parse(json) as string[]);
    }

    // The @Name resource references on one .mu line.
    public static MuRefs(line: string): string[]
    {
        const out: string[] = [];
        const re = /@([A-Za-z][A-Za-z0-9]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null)
        {
            const name = m[1];
            if (name !== undefined) out.push(name);
        }
        return out;
    }

    public static ScanMu(file: string, text: string, forbidden: ReadonlySet<string>): string[]
    {
        const hits: string[] = [];
        text.split('\n').forEach((line, i) =>
        {
            if (line.includes(SchemeMembershipScan.MaterialImport))
                hits.push(`${file}:${i + 1} imports ${SchemeMembershipScan.MaterialImport}`);
            for (const tok of SchemeMembershipScan.MuRefs(line))
                if (forbidden.has(tok))
                    hits.push(`${file}:${i + 1} @${tok} (Material token absent from Pragmatic)`);
        });
        return hits;
    }

    public static ScanTs(file: string, text: string, forbidden: ReadonlySet<string>): string[]
    {
        const hits: string[] = [];
        text.split('\n').forEach((line, i) =>
        {
            if (line.includes(SchemeMembershipScan.MaterialImport))
                hits.push(`${file}:${i + 1} imports ${SchemeMembershipScan.MaterialImport}`);
            if (!SchemeMembershipScan.TsKeyContexts.some(c => line.includes(c))) return;
            for (const tok of forbidden)
                if (new RegExp("['\"]" + tok + "['\"]").test(line))
                    hits.push(`${file}:${i + 1} '${tok}'`);
        });
        return hits;
    }

    // Locate this package's `src` root by walking up from this test file to the
    // nearest package.json (ESM-safe -- no __dirname). Location-independent, so
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
            if (statSync(p).isDirectory()) { SchemeMembershipScan.Walk(p, out); continue; }
            if (p.endsWith('.mu') || (p.endsWith('.ts') && !p.endsWith(SchemeMembershipScan.TestFile))) out.push(p);
        }
    }

    public static Offenders(fromUrl: string, forbidden: ReadonlySet<string>): string[]
    {
        const files: string[] = [];
        SchemeMembershipScan.Walk(SchemeMembershipScan.PackageSrc(fromUrl), files);
        const hits: string[] = [];
        for (const file of files)
        {
            const text = readFileSync(file, 'utf8');
            if (file.endsWith('.mu')) hits.push(...SchemeMembershipScan.ScanMu(file, text, forbidden));
            else hits.push(...SchemeMembershipScan.ScanTs(file, text, forbidden));
        }
        return hits;
    }
}

describe('this package carries no Material-3 tokens under the Pragmatic theme', () =>
{
    test('the forbidden set is derived from Material and excludes shared Pragmatic tokens', () =>
    {
        const forbidden = SchemeMembershipScan.ForbiddenTokens(import.meta.url);
        // Non-empty derivation: if the child failed to register the themes this trips.
        expect(forbidden.size).toBeGreaterThan(0);
        // Exhaustive: tokens a hand-list missed are all in the derived Material vocabulary.
        expect(forbidden.has('OnSurface')).toBe(true);
        expect(forbidden.has('OnSurfaceVariantHoverLayer')).toBe(true);
        expect(forbidden.has('StatePressOverlay')).toBe(true);
        expect(forbidden.has('DiagramCanvas')).toBe(true);
        // Shared token excluded; a Pragmatic-native token is never forbidden.
        expect(forbidden.has('Scrim')).toBe(false);
        expect(forbidden.has('Fg1')).toBe(false);
    });

    test('ScanMu flags only forbidden tokens, not native or local references', () =>
    {
        const forbidden = new Set(['OnSurface']);
        const hits = SchemeMembershipScan.ScanMu('x.mu', 'a = @OnSurface\nb = @Fg1\nc = @RowsPanel', forbidden);
        expect(hits.length).toBe(1);
        expect(hits[0]).toMatch(/x\.mu:1 @OnSurface/);
    });

    test('every M3 token has been migrated to a Pragmatic token', () =>
    {
        const offenders = SchemeMembershipScan.Offenders(import.meta.url, SchemeMembershipScan.ForbiddenTokens(import.meta.url));
        expect(offenders, `Material-3 references remain:\n${offenders.join('\n')}`).toEqual([]);
    });
});
