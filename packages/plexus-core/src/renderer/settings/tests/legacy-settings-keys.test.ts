import { describe, it, expect } from 'vitest'
import { LegacySettingsKeys } from '../legacy-settings-keys.js'

// Diagram→Board renamed the setting keys from `diagram.*` to `board.*`. A user's
// settings.json still holds the legacy `diagram.*` keys; LegacySettingsKeys.Apply
// rewrites them to `board.*` on load so saved board settings survive the rename.
describe('LegacySettingsKeys.Apply', () =>
{
  it('rewrites a legacy diagram.* key to its board.* form', () =>
  {
    expect(LegacySettingsKeys.Apply({ 'diagram.grid.show': true }))
      .toEqual({ 'board.grid.show': true })
  })

  it('keeps the canonical board.* value when both legacy and canonical exist (new wins)', () =>
  {
    const out = LegacySettingsKeys.Apply({ 'diagram.grid.show': true, 'board.grid.show': false })
    expect(out['board.grid.show']).toBe(false)
    expect('diagram.grid.show' in out).toBe(false)
  })

  it('passes through keys without the diagram. prefix untouched', () =>
  {
    expect(LegacySettingsKeys.Apply({ 'editor.fontSize': 14, 'board.grid.show': true }))
      .toEqual({ 'editor.fontSize': 14, 'board.grid.show': true })
  })

  it('does not treat a bare "diagram" key or a non-prefix match as legacy', () =>
  {
    // Only the "diagram." prefix migrates; an unrelated key stays.
    expect(LegacySettingsKeys.Apply({ 'mydiagram.x': 1 })).toEqual({ 'mydiagram.x': 1 })
  })
})
