import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyProfileCleanup } from '../legacy-profile-cleanup.js'

describe('LegacyProfileCleanup', () =>
{
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'legacy-profiles-')) })
    afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

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

    it('is best-effort: a file that cannot be removed is logged by name/code and start-up goes on', async () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        mkdirSync(join(dir, 'graph-profile.bin'))
        writeFileSync(join(dir, 'graph-profile.bin', 'inner'), 'x')
        writeFileSync(join(dir, 'tenant-profile.bin'), 'y')
        await expect(LegacyProfileCleanup.Run(dir)).resolves.toBeUndefined()
        expect(existsSync(join(dir, 'tenant-profile.bin'))).toBe(false)
        expect(warn).toHaveBeenCalledTimes(1)
        const logged = warn.mock.calls[0]
        expect(logged[1]).toBe('graph-profile.bin')
        expect(Object.keys(logged[2] as object).sort()).toEqual(['code', 'name'])
    })

    it('does not fail when they are absent', async () =>
    {
        await expect(LegacyProfileCleanup.Run(dir)).resolves.toBeUndefined()
        await expect(LegacyProfileCleanup.Run(join(dir, 'missing'))).resolves.toBeUndefined()
    })
})
