import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { E2eProfile } from '../e2e-profile'

describe('E2eProfile', () => {
    const created: E2eProfile[] = []
    afterEach(() => { for (const p of created.splice(0)) p.Dispose() })
    const make = (): E2eProfile =>
    {
        const p = E2eProfile.Create()
        created.push(p)
        return p
    }

    it('creates a fresh temporary user-data directory', () => {
        const p = make()
        expect(existsSync(p.Dir)).toBe(true)
        expect(p.Dir.startsWith(tmpdir())).toBe(true)
        expect(make().Dir).not.toBe(p.Dir)
    })

    it('launches Electron on that directory', () => {
        const p = make()
        expect(p.LaunchArgs).toEqual([`--user-data-dir=${p.Dir}`])
    })

    it('seeds the restore-session file inside the profile, not the developer profile', () => {
        const p = make()
        p.SeedSession(['C:/projects/a'])
        expect(p.SessionFile.startsWith(p.Dir)).toBe(true)
        expect(JSON.parse(readFileSync(p.SessionFile, 'utf8'))).toEqual(['C:/projects/a'])
    })

    it('owns only its own directory', () => {
        const p = make()
        expect(p.Owns(p.Dir)).toBe(true)
        expect(p.Owns(p.Dir.toUpperCase())).toBe(process.platform === 'win32')
        expect(p.Owns(join(p.Dir, '..'))).toBe(false)
        expect(p.Owns(join(tmpdir(), 'Electron'))).toBe(false)
    })

    it('Dispose removes the directory and everything the app wrote into it', () => {
        const p = E2eProfile.Create()
        mkdirSync(join(p.Dir, 'Local Storage'), { recursive: true })
        writeFileSync(join(p.Dir, 'Local Storage', 'session.bin'), 'x')
        p.Dispose()
        expect(existsSync(p.Dir)).toBe(false)
        expect(() => p.Dispose()).not.toThrow()
    })

    it('DisposeQuietly never throws, so a stuck temp dir cannot mask the run own failure', () => {
        const p = make()
        vi.spyOn(p, 'Dispose').mockImplementation(() => { throw new Error('EBUSY') })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(() => p.DisposeQuietly()).not.toThrow()
        expect(warn).toHaveBeenCalledOnce()
        warn.mockRestore()
        vi.mocked(p.Dispose).mockRestore()
    })

    it('DisposeQuietly removes the directory when it can', () => {
        const p = E2eProfile.Create()
        p.DisposeQuietly()
        expect(existsSync(p.Dir)).toBe(false)
    })
})
