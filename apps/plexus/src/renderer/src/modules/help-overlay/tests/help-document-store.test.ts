import { describe, test, expect } from 'vitest'
import { FlowDocument, Paragraph, Run } from '@pragmatic-tech-ai/mural/basic'
import { HelpDocumentStore } from '../help-document-store.js'

// Collect the plain text of every Run in a FlowDocument (Parent back-refs make
// the tree circular, so structural JSON isn't an option).
function plainText(doc: FlowDocument): string {
    const out: string[] = []
    for (const block of doc.Blocks.ToArray()) {
        if (block instanceof Paragraph) {
            for (const inline of block.Inlines.ToArray()) {
                if (inline instanceof Run) out.push(inline.Text)
            }
        }
    }
    return out.join(' ')
}

const MD = [
    '# Skills',
    'Intro text ignored for scenarios.',
    '',
    '## Create a skill',
    'Click New.',
    '',
    '## Run a skill',
    'Press Run.',
].join('\n')

function store(): HelpDocumentStore {
    // ServiceBase only stores the provider; a minimal stub is enough.
    const s = new HelpDocumentStore({ get: () => undefined, getRequired: () => { throw new Error('x') }, has: () => false } as never)
    s.registerDoc('t', MD)
    return s
}

describe('HelpDocumentStore', () => {
    test('slug lowercases and hyphenates', () => {
        expect(HelpDocumentStore.slug('Create a Skill!')).toBe('create-a-skill')
    })
    test('hasScenario is true for a registered H2, false otherwise', () => {
        const s = store()
        expect(s.hasScenario('t', 'create-a-skill')).toBe(true)
        expect(s.hasScenario('t', 'nope')).toBe(false)
        expect(s.hasScenario('missing', 'create-a-skill')).toBe(false)
    })
    test('getScenario renders only that section into a FlowDocument', () => {
        const doc = store().getScenario('t', 'run-a-skill')
        expect(doc).toBeInstanceOf(FlowDocument)
        // The rendered slice carries this scenario's body, not the other's.
        const text = plainText(doc!)
        expect(text).toContain('Run')
        expect(text).not.toContain('Click New')
    })
    test('getScenario caches — same FlowDocument instance on repeat calls', () => {
        const s = store()
        expect(s.getScenario('t', 'create-a-skill')).toBe(s.getScenario('t', 'create-a-skill'))
    })
    test('getScenario returns undefined for unknown doc/anchor', () => {
        expect(store().getScenario('t', 'nope')).toBeUndefined()
        expect(store().getScenario('missing', 'create-a-skill')).toBeUndefined()
    })
    test('the bundled skills doc registers its scenarios', () => {
        const s = store()  // ctor registered 'skills' from docs/skills.md?raw
        expect(s.hasScenario('skills', 'create-a-skill')).toBe(true)
        expect(s.hasScenario('skills', 'run-a-skill')).toBe(true)
    })
})
