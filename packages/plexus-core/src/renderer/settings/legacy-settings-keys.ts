// Back-compat for the Diagram→Board rename of persisted setting keys. The board
// setting definitions register under `board.*` in mural's ApplicationSettings, but a
// user's settings.json still holds the old `diagram.*` keys. ElectronSettingsStore.Load
// runs the loaded snapshot through Apply() before mural applies its overlay, so saved
// board settings (grid, default icon sizes, connector optimizer, …) keep applying.
export class LegacySettingsKeys
{
    private static readonly LegacyPrefix = 'diagram.'
    private static readonly CanonicalPrefix = 'board.'

    // Rewrite every legacy `diagram.<rest>` entry to `board.<rest>`. A canonical
    // `board.<rest>` already in the snapshot wins (it is the newer value); the legacy
    // key is dropped from the result. Keys without the legacy prefix pass through
    // untouched. Pure and order-independent.
    public static Apply(snapshot: Record<string, unknown>): Record<string, unknown>
    {
        const out: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(snapshot))
        {
            if (!key.startsWith(LegacySettingsKeys.LegacyPrefix))
            {
                out[key] = value
                continue
            }
            const canonical = LegacySettingsKeys.CanonicalPrefix + key.slice(LegacySettingsKeys.LegacyPrefix.length)
            // Canonical present (now or already migrated) wins — skip the legacy value.
            if (!(canonical in snapshot) && !(canonical in out))
            {
                out[canonical] = value
            }
        }
        return out
    }
}
