import { test, expect } from 'vitest'
import type { SettingDefinition } from '@pragmatic-tech-ai/mural/framework'

import { BoardModule } from '../board.module.mu.js'

// Regression for the canvas icon-size wiring. The arch-node canvas template binds
// $Self.(Board.DefaultIconWidth/Height) — inheritable attached DPs whose
// SettingValue tier reads the board.DefaultIconWidth/Height app settings through
// the SettingSourceKey→ApplicationSettings bridge. If the board module stops
// contributing those definitions, ApplicationSettings.Get returns undefined and the
// DP falls back to its registration default (0), collapsing the stretched icon.
// These keys/defaults must match mural's BoardSettingKey.DefaultIconWidth/Height.
function settingByKey(key: string): SettingDefinition | undefined
{
    return [...BoardModule.Settings].find((d) => d.Key === key)
}

test.each([
    ['board.DefaultIconWidth'],
    ['board.DefaultIconHeight'],
])('the board module contributes %s with a non-zero default (icon size wiring)', (key) => {
    const def = settingByKey(key)
    expect(def, `${key} must be contributed so the DP resolves a real size`).toBeDefined()
    expect(def!.Default).toBe(80)
})

// The "Side ports optimizer" choice must be contributed from module load so it
// shows in the settings page before any board mounts to self-publish it. Mirrors
// mural's BoardSettingKey.ConnectorSidePortsOptimizer (SidePortsOptimizer enum).
test('the board module contributes the side-ports optimizer Choice with both options', () => {
    const def = settingByKey('board.connector.sidePortsOptimizer')
    expect(def, 'side-ports optimizer setting must be contributed').toBeDefined()
    expect(def!.Default).toBe('Optimized')
    expect([...(def!.Choices ?? [])]).toEqual(['Optimized', 'BruteForce'])
})
