// Canned transcript/tool cards for the dev-only Template Gallery. One
// representative instance of each card type the agent produces, so the .mu
// DataTemplates can be previewed (and iterated on) without driving the real
// agent. Commands are wired to no-ops; clicking through a card still previews
// its answered/recap state. Kept as pure builders so the sample data lives in
// one place and is easy to extend.
import { MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import type { ApprovalRule } from '../../../../../shared/agent-api.js'
import { UserMessage, AssistantMessage, ToolActivity } from './transcript.js'
import { QuestionCard } from './question-card.js'
import { ToolApprovalCard } from './approval-card.js'
import { ApprovalRuleRow } from './approval-rules.js'

// Long enough that the approval-card countdown ring stays effectively static
// while you inspect it, instead of auto-resolving after the real 10s.
export const GALLERY_COUNTDOWN_MS = 600_000

const SAMPLE_MARKDOWN =
    'Here is a **formatted** assistant reply.\n\n'
    + '- a bullet with `inline code`\n'
    + '- a second bullet\n\n'
    + '```ts\nconst answer = 42\n```\n\n'
    + '> A short block quote to check quote styling.'

// One instance of every card type, in the order they'd plausibly appear.
export function galleryCards(): MuralBase[]
{
    const cards: MuralBase[] = []

    cards.push(new UserMessage('Run the tests and tell me what fails.'))

    const assistant = new AssistantMessage()
    assistant.appendText(SAMPLE_MARKDOWN)
    cards.push(assistant)

    // ToolActivity — running (no output yet).
    cards.push(new ToolActivity('gallery-run', 'Bash', { command: 'npm test -- --run', description: 'run the unit suite' }))

    // ToolActivity — done (with captured output).
    const done = new ToolActivity('gallery-done', 'Read', { file_path: 'src/main.ts' })
    done.setStatus('done')
    done.setOutput('1  import { app } from "./app.mu.js"\n2  // …first 20 lines of the file…')
    cards.push(done)

    // QuestionCard — single-select (with option descriptions).
    cards.push(new QuestionCard(
        {
            id: 'gallery-q1',
            questions: [{
                question: 'Which approach should I take?', header: 'Approach', multiSelect: false,
                options: [
                    { label: 'MVP first', description: 'Ship the smallest thing that works.' },
                    { label: 'Risk first', description: 'Tackle the riskiest unknown up front.' },
                ],
            }],
        },
        () => { /* gallery: no-op */ },
    ))

    // QuestionCard — multi-select.
    cards.push(new QuestionCard(
        {
            id: 'gallery-q2',
            questions: [{
                question: 'Which features do you want?', header: 'Features', multiSelect: true,
                options: [{ label: 'Auth' }, { label: 'Billing' }, { label: 'Analytics' }],
            }],
        },
        () => { /* gallery: no-op */ },
    ))

    // ToolApprovalCard — pending, long countdown so the ring stays put.
    cards.push(new ToolApprovalCard(
        { id: 'gallery-a1', toolName: 'Bash', command: 'python analyze.py --verbose', prefix: 'python' },
        () => { /* gallery: no-op */ },
        GALLERY_COUNTDOWN_MS,
    ))

    // ApprovalRuleRow — a couple of persistent rules (prefixed + tool-only).
    const noRevoke = (_rule: ApprovalRule): void => { /* gallery: no-op */ }
    cards.push(new ApprovalRuleRow({ tool: 'Bash', prefix: 'python' }, noRevoke))
    cards.push(new ApprovalRuleRow({ tool: 'WebFetch' }, noRevoke))

    return cards
}
