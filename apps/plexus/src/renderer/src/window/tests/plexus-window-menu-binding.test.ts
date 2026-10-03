import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Structural guard over the COMPILED menu bar. The "Toggle Side Bar" View-menu
// item must bind the shell-scoped NavigationService.ToggleSidePaneCommand — the
// one service the header's $service(...) can actually reach — NOT the dead
// ViewCommandsService.ToggleSideBarCommand (ViewCommandsService is root-scoped
// and resolution is upward-only, so that indirection was a no-op). The compiled
// .mu.js is the authoritative record of what the markup lowered to.
class CompiledMenu
{
    private static readonly CompiledMenuRelativePath = '../plexus-window.resources.mu.js'
    private static readonly ToggleSideBarHeader = 'Toggle Side Bar'
    private static readonly ServiceBindingPattern =
        'set_property_value\\(MenuItem\\.CommandKey, ServiceBinding\\(\\1, ServiceProvider\\.tokenFor\\((\\w+)\\), "(\\w+)"\\)\\)'

    private readonly _source: string

    public constructor()
    {
        const path = fileURLToPath(new URL(CompiledMenu.CompiledMenuRelativePath, import.meta.url))
        this._source = readFileSync(path, 'utf8')
    }

    // Returns [serviceSymbol, commandPath] the "Toggle Side Bar" item binds its
    // Command to, by locating the MenuItem whose Header is that label and reading
    // the CommandKey ServiceBinding emitted for that same element.
    public ToggleSideBarBinding(): { service: string, path: string }
    {
        const headerPattern = new RegExp(
            `(_menuItem\\d+)\\.set_property_value\\(MenuItem\\.HeaderKey, "${CompiledMenu.ToggleSideBarHeader}"\\)` +
            `[\\s\\S]*?` + CompiledMenu.ServiceBindingPattern,
        )
        const match = headerPattern.exec(this._source)
        if (match === null) throw new Error('Toggle Side Bar MenuItem Command binding not found in compiled menu.')
        return { service: match[2], path: match[3] }
    }
}

test('the compiled "Toggle Side Bar" menu item binds NavigationService.ToggleSidePaneCommand', () => {
    const binding = new CompiledMenu().ToggleSideBarBinding()
    expect(binding.service).toBe('NavigationService')
    expect(binding.path).toBe('ToggleSidePaneCommand')
})
