import { test, expect } from 'vitest'
import { ShortenPathConverter } from '../shorten-path.js'

// A converter with an injected separator, so the formatting is tested without an
// Electron host (no EnvironmentService).
const win = new ShortenPathConverter(() => '\\')
const posix = new ShortenPathConverter(() => '/')

test('replaces each intermediate directory with .. (the spec example)', () => {
  expect(win.convert('C:\\test\\tes2\\test3\\project.plexus')).toBe('C:\\test\\..\\..\\project.plexus')
})

test('a single intermediate directory collapses to one ..', () => {
  expect(win.convert('C:\\a\\b\\project.plexus')).toBe('C:\\a\\..\\project.plexus')
})

test('three or fewer segments are returned unchanged', () => {
  expect(win.convert('C:\\test\\project.plexus')).toBe('C:\\test\\project.plexus')
  expect(win.convert('C:\\project.plexus')).toBe('C:\\project.plexus')
})

test('a deep path keeps root + first dir + leaf, .. for every hidden dir', () => {
  expect(win.convert('C:\\Users\\Eugene\\Projects\\app\\projects\\test_waf_project'))
    .toBe('C:\\Users\\..\\..\\..\\..\\test_waf_project')
})

test('rejoins with the injected (POSIX) separator', () => {
  expect(posix.convert('/home/eugene/projects/app/thing')).toBe('/home/../../../thing')
})

test('non-string input coerces to a string', () => {
  expect(win.convert(undefined)).toBe('')
})
