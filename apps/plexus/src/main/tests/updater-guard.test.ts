import { describe, it, expect } from 'vitest'
import { shouldAutoUpdate } from '../updater-guard'

describe('shouldAutoUpdate', () => {
  it('is true only for a Linux AppImage run', () => {
    expect(shouldAutoUpdate('linux', { APPIMAGE: '/tmp/Plexus.AppImage' })).toBe(true)
  })
  it('is false on Linux when not an AppImage (no APPIMAGE env)', () => {
    expect(shouldAutoUpdate('linux', {})).toBe(false)
  })
  it('is false on Windows even with APPIMAGE set', () => {
    expect(shouldAutoUpdate('win32', { APPIMAGE: '/x' })).toBe(false)
  })
  it('is false on macOS', () => {
    expect(shouldAutoUpdate('darwin', {})).toBe(false)
  })
})
