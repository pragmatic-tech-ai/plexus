/**
 * Shape of an Electron `Display.bounds` entry. Declared locally so this helper
 * stays free of any Electron import and can be unit-tested headless.
 */
export interface DisplayBounds
{
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Picks where the e2e windows should be placed so they land on the operator's
 * second monitor. Pure: operates only on the display list it is handed.
 */
export class DisplayPlacement
{
    private static readonly OverridePattern = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/;
    private static readonly PrimaryX = 0;
    private static readonly PrimaryY = 0;
    private static readonly WindowPositionFlag = '--window-position=';
    private static readonly CoordinateSeparator = ',';

    /**
     * Resolves the target window origin. An explicit `"x,y"` override wins; otherwise
     * the first non-primary display's origin; otherwise the origin (0,0).
     */
    public static TargetOrigin(displays: readonly DisplayBounds[], override?: string): { x: number; y: number }
    {
        const fromOverride = DisplayPlacement.ParseOverride(override);
        if (fromOverride !== undefined)
        {
            return fromOverride;
        }

        const secondary = displays.find((display) => !DisplayPlacement.IsPrimary(display));
        if (secondary !== undefined)
        {
            return { x: secondary.x, y: secondary.y };
        }

        return { x: DisplayPlacement.PrimaryX, y: DisplayPlacement.PrimaryY };
    }

    /** Formats an origin as the chromium `--window-position=<x>,<y>` command-line flag. */
    public static ChromiumWindowPositionArg(origin: { x: number; y: number }): string
    {
        return `${DisplayPlacement.WindowPositionFlag}${origin.x}${DisplayPlacement.CoordinateSeparator}${origin.y}`;
    }

    private static ParseOverride(override: string | undefined): { x: number; y: number } | undefined
    {
        if (override === undefined)
        {
            return undefined;
        }

        const match = DisplayPlacement.OverridePattern.exec(override);
        if (match === null)
        {
            return undefined;
        }

        return { x: Number(match[1]), y: Number(match[2]) };
    }

    // Treating the display at origin (0,0) as primary is a deliberate Windows approximation (per the brief).
    private static IsPrimary(display: DisplayBounds): boolean
    {
        return display.x === DisplayPlacement.PrimaryX && display.y === DisplayPlacement.PrimaryY;
    }
}
