import { test, expect } from 'vitest'
import { TabControl } from '@pragmatic-tech-ai/mural/framework'
import { ExtendedTabControl } from '../extended-tab-control.js'

// ExtendedTabControl is a thin re-template of mural's TabControl: it must BE a
// TabControl (so the document-host template's ItemsSource/SelectedItem bindings
// and the tab machinery all work) and carry its own DefaultStyleKey so the
// Plexus Style[TargetType=ExtendedTabControl] (the reserved-corner template)
// resolves instead of the base TabControl chrome.
test('is a TabControl subclass and constructs without a mounted app', () => {
    const tabs = new ExtendedTabControl()
    expect(tabs).toBeInstanceOf(TabControl)
})

test('overrides DefaultStyleKey to itself so its own template resolves', () => {
    const tabs = new ExtendedTabControl()
    expect(tabs.DefaultStyleKey).toBe(ExtendedTabControl)
})
