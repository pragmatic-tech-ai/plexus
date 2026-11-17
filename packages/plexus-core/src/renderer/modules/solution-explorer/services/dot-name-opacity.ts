import { type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'

// Dims hierarchy rows whose name starts with a dot (".claude", ".git", …) so hidden /
// tooling files and folders recede visually. The row template binds a row's Opacity to
// this converter over its Caption, so a rename re-evaluates and synthetic rows (whose
// captions are labels like "Connections") are never dimmed.
export class DimmedNames
{
    private static readonly DotPrefix = '.'
    private static readonly DimmedOpacity = 0.4
    private static readonly FullOpacity = 1

    // Caption can be undefined for a row the tree binds before it has one — a bare
    // startsWith there would throw and crash the row's render, so guard the type.
    public static IsDotName(caption: string): boolean
    {
        return typeof caption === 'string' && caption.startsWith(DimmedNames.DotPrefix)
    }

    public static OpacityFor(caption: string): number
    {
        return DimmedNames.IsDotName(caption) ? DimmedNames.DimmedOpacity : DimmedNames.FullOpacity
    }
}

export const DotNameToOpacity: ValueConverter = {
    convert: (caption: unknown) => DimmedNames.OpacityFor(caption as string),
}
