import { test, expect } from 'vitest'
import { bumpVersion, isValidVersion, VersionPart } from '../semver-bump.js'

test('bumpVersion increments the chosen part and zeros the lower parts', () => {
    expect(bumpVersion('0.1.0', VersionPart.Minor)).toBe('0.2.0')
    expect(bumpVersion('1.2.3', VersionPart.Major)).toBe('2.0.0')
    expect(bumpVersion('1.2.3', VersionPart.Minor)).toBe('1.3.0')
    expect(bumpVersion('1.2.3', VersionPart.Patch)).toBe('1.2.4')
})

test('bumpVersion is lenient on non-semver input (missing parts default to 0)', () => {
    expect(bumpVersion('5', VersionPart.Major)).toBe('6.0.0')
    expect(bumpVersion('5', VersionPart.Patch)).toBe('5.0.1')
    expect(bumpVersion('', VersionPart.Minor)).toBe('0.1.0')
})

test('isValidVersion accepts semver-ish + rejects empty / path-hostile strings', () => {
    expect(isValidVersion('0.1.0')).toBe(true)
    expect(isValidVersion('5')).toBe(true)
    expect(isValidVersion('1.0.0-rc.1')).toBe(true)
    expect(isValidVersion('')).toBe(false)
    expect(isValidVersion('   ')).toBe(false)
    expect(isValidVersion('../x')).toBe(false)
    expect(isValidVersion('a/b')).toBe(false)
})
