import { describe, test, expect } from 'vitest'
import { AdornerDecorator, Help } from '@pragmatic-tech-ai/mural/visual-engine'
import { Border } from '@pragmatic-tech-ai/mural/basic'
import { HelpDocumentStore } from '../help-document-store.js'
import { HelpOverlayController } from '../help-overlay-behavior.js'

function makeStore(): HelpDocumentStore {
    const s = new HelpDocumentStore({ get: () => undefined, getRequired: () => { throw new Error() }, has: () => false } as never)
    s.registerDoc('skills', '# S\n## Create a skill\nHello.')
    return s
}

describe('HelpOverlayController', () => {
    test('handleMove shows a hotspot for the nearest ancestor with a valid Help.Topic', () => {
        const deco = new AdornerDecorator()
        const tagged = new Border(); Help.SetTopic(tagged, 'skills#create-a-skill')
        const leaf = new Border(); tagged.SetChild(leaf)   // leaf nested under the tagged control
        deco.Child = tagged
        const c = new HelpOverlayController(deco, makeStore())
        c.handleMove(leaf)
        expect(c.CurrentTarget).toBe(tagged)
        expect(deco.AdornerLayer.GetAdorners(tagged)?.length).toBe(1)
        c.dispose()
    })

    test('handleMove over a subtree with no Help.Topic shows nothing', () => {
        const deco = new AdornerDecorator()
        const plain = new Border(); deco.Child = plain
        const c = new HelpOverlayController(deco, makeStore())
        c.handleMove(plain)
        expect(c.CurrentTarget).toBeUndefined()
        c.dispose()
    })

    test('a Help.Topic with no matching scenario is ignored', () => {
        const deco = new AdornerDecorator()
        const tagged = new Border(); Help.SetTopic(tagged, 'skills#does-not-exist')
        deco.Child = tagged
        const c = new HelpOverlayController(deco, makeStore())
        c.handleMove(tagged)
        expect(c.CurrentTarget).toBeUndefined()
        c.dispose()
    })

    test('dispose removes a live hotspot', () => {
        const deco = new AdornerDecorator()
        const tagged = new Border(); Help.SetTopic(tagged, 'skills#create-a-skill')
        deco.Child = tagged
        const c = new HelpOverlayController(deco, makeStore())
        c.handleMove(tagged)
        expect(deco.AdornerLayer.GetAdorners(tagged)?.length).toBe(1)
        c.dispose()
        expect(deco.AdornerLayer.GetAdorners(tagged)?.length ?? 0).toBe(0)
    })
})
