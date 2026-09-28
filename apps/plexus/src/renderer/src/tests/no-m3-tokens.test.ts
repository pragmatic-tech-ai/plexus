import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

class M3TokenScan
{
    private static readonly MuTokens: readonly string[] =
    [
        'OnSurfaceVariant', 'OnSurface', 'SurfaceContainerHighest', 'SurfaceContainerHigh', 'SurfaceContainerLow',
        'SurfaceContainer', 'Surface', 'PrimaryContainer', 'OnPrimary', 'Primary',
        'SecondaryContainer', 'OutlineVariant', 'Outline', 'Error', 'StateHoverOverlay',
        'ShapeExtraSmall', 'ShapeSmall', 'ShapeFull', 'BodyLarge', 'BodyMedium',
        'BodySmall', 'TitleMedium', 'TitleSmall', 'LabelLarge', 'LabelMedium',
        'LabelSmall', 'Elevation2',
        'OnSurfaceVariantHoverLayer', 'OnSurfaceVariantPressLayer', 'OnPrimaryHoverLayer', 'OnPrimaryPressLayer',
        'StatePressOverlay', 'TextSelectionBrush', 'DiagramCanvas', 'DisabledContentOpacity', 'Spacing[0-9]+',
        'LabelLargeSize', 'LabelLargeLineHeight', 'LabelLargeTracking', 'LabelLargeWeight', 'LabelLargeFont',
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
