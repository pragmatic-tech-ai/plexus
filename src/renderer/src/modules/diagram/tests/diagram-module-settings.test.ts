import { test, expect } from 'vitest'
import type { SettingDefinition } from '@pragmatic-tech-ai/mural/framework'

import { DiagramModule } from '../diagram.module.mu.js'

// Regression for the canvas icon-size wiring. The arch-node canvas template binds
// $Self.(Diagram.DefaultIconWidth/Height) — inheritable attached DPs whose
// SettingValue tier reads the diagram.DefaultIconWidth/Height app settings through
// the SettingSourceKey→ApplicationSettings bridge. If the diagram module stops
// contributing those definitions, ApplicationSettings.Get returns undefined and the
// DP falls back to its registration default (0), collapsing the stretched icon.
// These keys/defaults must match mural's DiagramSettingKey.DefaultIconWidth/Height.
function settingByKey(key: string): SettingDefinition | undefined {
    return [...DiagramModule.Settings].find((d) => d.Key === key)
}

test.each([
    ['diagram.DefaultIconWidth'],
    ['diagram.DefaultIconHeight'],
])('the diagram module contributes %s with a non-zero default (icon size wiring)', (key) => {
    const def = settingByKey(key)
    expect(def, `${key} must be contributed so the DP resolves a real size`).toBeDefined()
    expect(def!.Default).toBe(80)
})
