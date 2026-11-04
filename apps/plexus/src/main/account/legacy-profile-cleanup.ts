import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Before sign-in, Plexus kept a hand-entered server URL + token per feature. Sign-in replaces both,
// so the old encrypted profiles are discarded at start-up (idempotent: nothing to do once gone).
// Best-effort: a file that cannot be removed (locked, no permission) is logged by error name/code
// only and left for the next start; it never fails start-up.
export class LegacyProfileCleanup
{
    private static readonly LegacyFiles: readonly string[] = ['graph-profile.bin', 'tenant-profile.bin']
    private static readonly FailedLog = '[account] could not remove a legacy profile file:'

    public static async Run(dir: string): Promise<void>
    {
        await Promise.all(LegacyProfileCleanup.LegacyFiles.map(file => LegacyProfileCleanup.Remove(dir, file)))
    }

    private static async Remove(dir: string, file: string): Promise<void>
    {
        try
        {
            await fs.rm(join(dir, file), { force: true })
        }
        catch (e)
        {
            const { name, code } = (typeof e === 'object' && e !== null ? e : {}) as { name?: unknown; code?: unknown }
            console.warn(LegacyProfileCleanup.FailedLog, file, { name, code })
        }
    }
}
