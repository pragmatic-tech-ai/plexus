import { test, expect } from 'vitest'
import { galleryCards } from '../gallery-fixtures.js'
import { UserMessage, AssistantMessage, ToolActivity } from '../transcript.js'
import { QuestionCard } from '../question-card.js'
import { ToolApprovalCard } from '../approval-card.js'
import { ApprovalRuleRow } from '../approval-rules.js'

test('galleryCards includes one representative instance of every card type', () => {
    const cards = galleryCards()
    const has = (ctor: new (...a: never[]) => unknown) => cards.some((c) => c instanceof ctor)
    expect(has(UserMessage)).toBe(true)
    expect(has(AssistantMessage)).toBe(true)
    expect(has(ToolActivity)).toBe(true)
    expect(has(QuestionCard)).toBe(true)
    expect(has(ToolApprovalCard)).toBe(true)
    expect(has(ApprovalRuleRow)).toBe(true)
    for (const c of cards) (c as { dispose?: () => void }).dispose?.()
})

test('a ToolActivity is shown in both running and done states', () => {
    const activities = galleryCards().filter((c) => c instanceof ToolActivity) as ToolActivity[]
    const statuses = activities.map((a) => a.Status)
    expect(statuses).toContain('running')
    expect(statuses).toContain('done')
})

test('the approval card carries a prefixed always-allow label and stays pending', () => {
    const cards = galleryCards()
    const approval = cards.find((c) => c instanceof ToolApprovalCard) as ToolApprovalCard
    expect(approval.AllowAlwaysLabel).toBe('Always allow python')
    expect(approval.IsPending).toBe(true)
    for (const c of cards) (c as { dispose?: () => void }).dispose?.()
})
