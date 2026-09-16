import { describe, it, expect } from 'vitest'
import { ToolboxVisualDescriptor } from '@pragmatic-tech-ai/mural/framework'
import { LibraryToolboxPage } from '../library-toolbox-page.js'
import type { TodlPresentationRegistry } from '../todl-presentation-registry.js'

// A registry stub exposing iconKeyFor (the EntityIconVM surface the page's tiles use).
const reg = (index = new Map<string, string>()) =>
    ({ iconKeyFor: (k: string) => index.get(k) }) as unknown as TodlPresentationRegistry

describe('LibraryToolboxPage', () => {
    it('setTerms reconciles items by key without clearing, and carries its ref as Context', () => {
        const page = new LibraryToolboxPage('tax:lib', 'Lib', 'lib@1.0.0', '', reg())
        page.setTerms([{ id: 't1', label: 'One' }])
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:t1'])
        expect(page.Context).toBe('lib@1.0.0')

        const first = page.Items.Get(0)
        const events: string[] = []
        page.Items.Subscribe((e) => events.push(e.kind))
        page.setTerms([{ id: 't1', label: 'One' }, { id: 't2', label: 'Two' }])
        expect(page.Items.ToArray().map((i) => i.Id)).toEqual(['term:t1', 'term:t2'])
        expect(page.Items.Get(0)).toBe(first)        // t1 kept its instance
        expect(events).not.toContain('cleared')
    })

    it('applies the mm: descriptor-key prefix for meta-model taxonomies', () => {
        const page = new LibraryToolboxPage('tax:actors', 'Actors', 'mm@1.0.0', 'mm:', reg(new Map([['mm:actors.internal', 'icon-int']])))
        page.setTerms([{ id: 'actors.internal', label: 'Internal' }])
        const item = page.Items.Get(0)!
        expect((item.Descriptor as ToolboxVisualDescriptor).Key).toBe('mm:actors.internal')
        // The tile's icon VM resolves the same key through the registry index.
        expect(item.Icon.IconKey).toBe('icon-int')
    })
})
