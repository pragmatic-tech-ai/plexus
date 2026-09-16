import { describe, test, expect } from 'vitest'
import { Updater } from '../updater.js'

describe('Updater.shouldAutoUpdate', () => {
    test('auto-updates only for a packaged Linux AppImage', () => {
        expect(Updater.shouldAutoUpdate('linux', { APPIMAGE: '/x.AppImage' } as NodeJS.ProcessEnv)).toBe(true)
        expect(Updater.shouldAutoUpdate('linux', {} as NodeJS.ProcessEnv)).toBe(false) // not packaged
        expect(Updater.shouldAutoUpdate('win32', { APPIMAGE: '/x' } as NodeJS.ProcessEnv)).toBe(false) // MSI = manual
    })
})
