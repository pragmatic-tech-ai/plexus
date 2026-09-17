import { describe, it, expect } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { ShellControlAlignment, ShellModule, ShellRegion } from '@pragmatic-tech-ai/mural/framework'
import { ThemeSchemePicker } from '../theme-scheme-picker.js'

// ThemeSchemePicker.register adds a right-aligned status-bar shell control to the
// app's first composed ShellModule. The control's template is a lazy DataTemplate
// (its factory news the ThemeSelector only when applied), so registering needs no
// active theme — we assert the ShellControlDefinition placement, not the visual.
describe('ThemeSchemePicker', () => {
    it('adds a StatusBar/End control to the first composed ShellModule', () => {
        const app = new Application()
        const shell = new ShellModule()
        app.Modules.Add(shell)

        ThemeSchemePicker.register(app)

        expect(shell.ShellControls.Count).toBe(1)
        const def = shell.ShellControls.Get(0)
        expect(def.Region).toBe(ShellRegion.StatusBar)
        expect(def.Alignment).toBe(ShellControlAlignment.End)
        expect(def.Template).toBeDefined()
    })

    it('no-ops when the app has no composed modules', () => {
        const app = new Application()
        expect(() => ThemeSchemePicker.register(app)).not.toThrow()
    })
})
