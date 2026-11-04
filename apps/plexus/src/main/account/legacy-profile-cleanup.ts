import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// Before sign-in, Plexus kept a hand-entered server URL + token per feature. Sign-in replaces both,
// so the old encrypted profiles are discarded at start-up (idempotent: nothing to do once gone).
export class LegacyProfileCleanup
{
    private static readonly LegacyFiles: readonly string[] = ['graph-profile.bin', 'tenant-profile.bin']

    public static async Run(dir: string): Promise<void>
    {
        await Promise.all(LegacyProfileCleanup.LegacyFiles.map(name => fs.rm(join(dir, name), { force: true })))
    }
}
