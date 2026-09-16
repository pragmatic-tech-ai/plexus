import { test, expect } from 'vitest'
import { QuestionCard } from '../question-card.js'
import type { QuestionAnswer, QuestionRequest } from '../../../../../../shared/agent-api.js'

function card(request: QuestionRequest, onSubmit: (a: QuestionAnswer) => void = () => {}): QuestionCard
{
    return new QuestionCard(request, onSubmit)
}

const SINGLE: QuestionRequest = { id: 'q1', questions: [
    { question: 'Approach?', header: 'Approach', multiSelect: false, options: [{ label: 'A' }, { label: 'B', description: 'the B one' }] },
] }

const MULTI: QuestionRequest = { id: 'q2', questions: [
    { question: 'Which features?', header: 'Features', multiSelect: true, options: [{ label: 'X' }, { label: 'Y' }, { label: 'Z' }] },
] }

test('single-select: SelectedOption is the answer (radio owns exclusion)', () => {
    const c = card(SINGLE)
    const q = c.Questions.ToArray()[0]!
    const opts = q.Options.ToArray()
    // The RadioButtonGroup writes the chosen OptionVM into SelectedOption;
    // it's a single value, so a second pick simply replaces the first.
    q.SelectedOption = opts[0]!
    q.SelectedOption = opts[1]!
    expect(c.BuildAnswer()).toEqual({ id: 'q1', answers: { 'Approach?': ['B'] } })
})

test('multi-select accumulates selections', () => {
    const c = card(MULTI)
    const opts = c.Questions.ToArray()[0]!.Options.ToArray()
    opts[0]!.IsSelected = true
    opts[2]!.IsSelected = true
    expect(c.BuildAnswer().answers['Which features?']).toEqual(['X', 'Z'])
})

test('Other is the trailing option and contributes its typed text', () => {
    const c = card(SINGLE)
    const q = c.Questions.ToArray()[0]!
    // Two real options + the synthetic Other row.
    expect(q.Options.ToArray()).toHaveLength(3)
    expect(q.OtherOption.IsOther).toBe(true)
    q.SelectedOption = q.OtherOption          // the RadioButtonGroup picks Other
    q.OtherText = 'something else'
    expect(q.IsOtherChosen).toBe(true)        // editor is revealed
    expect(c.BuildAnswer().answers['Approach?']).toEqual(['something else'])
})

test('single-select: choosing a real option after Other hides the editor', () => {
    const c = card(SINGLE)
    const q = c.Questions.ToArray()[0]!
    q.SelectedOption = q.OtherOption
    q.OtherText = 'typed'
    expect(q.IsOtherChosen).toBe(true)
    q.SelectedOption = q.Options.ToArray()[0]!   // radio replaces the pick
    expect(q.IsOtherChosen).toBe(false)
    expect(c.BuildAnswer().answers['Approach?']).toEqual(['A'])
})

test('Other chosen but empty is not a selection until text is typed', () => {
    const c = card(SINGLE)
    const q = c.Questions.ToArray()[0]!
    q.SelectedOption = q.OtherOption
    expect(q.HasSelection).toBe(false)           // no text yet
    q.OtherText = 'x'
    expect(q.HasSelection).toBe(true)
})

test('IsSubmittable flips true only once every question has a selection; Submit fires the answer', () => {
    let submitted: QuestionAnswer | undefined
    const req: QuestionRequest = { id: 'q3', questions: [SINGLE.questions[0]!, MULTI.questions[0]!] }
    const c = card(req, (a) => { submitted = a })
    expect(c.IsSubmittable).toBe(false)
    c.Questions.ToArray()[0]!.SelectedOption = c.Questions.ToArray()[0]!.Options.ToArray()[0]!  // 'A'
    expect(c.IsSubmittable).toBe(false)                 // second question still empty
    c.Questions.ToArray()[1]!.Options.ToArray()[1]!.IsSelected = true                            // 'Y'
    expect(c.IsSubmittable).toBe(true)

    c.SubmitCommand.Execute(undefined)
    expect(c.IsAnswered).toBe(true)
    expect(c.IsPending).toBe(false)
    expect(submitted).toEqual({ id: 'q3', answers: { 'Approach?': ['A'], 'Which features?': ['Y'] } })
})

test('an unselected Other does not count as a selection', () => {
    const c = card(SINGLE)
    const q = c.Questions.ToArray()[0]!
    q.OtherText = 'typed but not toggled'
    expect(q.HasSelection).toBe(false)
    expect(c.IsSubmittable).toBe(false)
})
