import { test, expect } from 'vitest'
import { load } from '@pragmatic-tech-ai/todl'
import { dropRejectionMessage } from '../drop-rejection.js'

// location is framed by Model but NOT Scenarios; component (a materialize root)
// references location via `in`, so a location dropped on a Scenarios diagram would
// otherwise silently become a component.
const MM = `namespace archmm {
  annotation materialize { concept : identifier?; via : identifier?; propagate : boolean?; }
  concept location {}
  concept component { annotate materialize {} relationship in -> location; }
  viewpoint Model : frames component, location
  viewpoint Scenarios : frames component
  taxonomy Regions : represents location { term azure { label = "Azure"; } }
}`

test('the rejection message names the term, the blocking viewpoint, the wrong node, and the fix', () => {
    const repo = load([{ uri: 'mm.todl', text: MM }]).model
    const { title, message } = dropRejectionMessage(repo, 'Regions.azure', new Set(['Scenarios']))

    expect(title).toContain('Azure')                 // what you dropped
    expect(message).toContain('location')            // its concept
    expect(message).toContain('Scenarios')           // the diagram's viewpoint that blocks it
    expect(message).toContain('component')           // what it would have WRONGLY created
    expect(message).toMatch(/\bin\b/)                // the member it would have filled
    expect(message).toContain('Model')               // the fix: a viewpoint that frames location
})
