import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegacyProfileCleanup } from '../legacy-profile-cleanup.js'

describe('LegacyProfileCleanup', () =>
{
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'legacy-profiles-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it('deletes the two legacy profile files when present and leaves everything else', async () =>
    {
        writeFileSync(join(dir, 'graph-profile.bin'), 'x')
        writeFileSync(join(dir, 'tenant-profile.bin'), 'y')
        writeFileSync(join(dir, 'desktop-session.bin'), 'z')
        await LegacyProfileCleanup.Run(dir)
        expect(existsSync(join(dir, 'graph-profile.bin'))).toBe(false)
        expect(existsSync(join(dir, 'tenant-profile.bin'))).toBe(false)
        expect(readdirSync(dir)).toEqual(['desktop-session.bin'])
    })

    it('does not fail when they are absent', async () =>
    {
        await expect(LegacyProfileCleanup.Run(dir)).resolves.toBeUndefined()
        await expect(LegacyProfileCleanup.Run(join(dir, 'missing'))).resolves.toBeUndefined()
    })
})
