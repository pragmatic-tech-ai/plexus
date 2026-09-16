import { test, expect } from 'vitest'
import { Key } from '@pragmatic-tech-ai/mural/runtime'
import { StoredConversationRow, type ConversationRowCallbacks } from '../stored-conversation-row.js'
import type { StoredConversation } from '../chat-store.js'

const record: StoredConversation = { Id: 's1', Title: 'Old title', ResumeToken: 't', Cwd: '/proj', UpdatedAt: 5000, Transcript: [] }

function makeRow(over: Partial<StoredConversation> = {}) {
    const calls = { opened: [] as string[], renamed: [] as Array<{ id: string; title: string }>, deleted: [] as string[] }
    const cb: ConversationRowCallbacks = {
        open: (id) => calls.opened.push(id),
        rename: (id, title) => calls.renamed.push({ id, title }),
        delete: (id) => calls.deleted.push(id),
    }
    return { row: new StoredConversationRow({ ...record, ...over }, cb), calls }
}

test('OpenCommand reveals the conversation by id', () => {
    const { row, calls } = makeRow()
    row.OpenCommand.Execute(undefined)
    expect(calls.opened).toEqual(['s1'])
})

test('DeleteCommand removes the conversation by id', () => {
    const { row, calls } = makeRow()
    row.DeleteCommand.Execute(undefined)
    expect(calls.deleted).toEqual(['s1'])
})

test('RefreshTime formats the record timestamp against a supplied clock', () => {
    const { row } = makeRow({ UpdatedAt: 1_000_000 })
    row.RefreshTime(1_000_000 + 3 * 60 * 60 * 1000)   // +3h
    expect(row.TimeAgo).toBe('3h')
})

test('begin rename seeds the editor with the current title and enters edit mode', () => {
    const { row } = makeRow()
    row.BeginRenameCommand.Execute(undefined)
    expect(row.IsEditing).toBe(true)
    expect(row.EditTitle).toBe('Old title')
})

test('Enter commits a changed title — updates the row and calls back', () => {
    const { row, calls } = makeRow()
    row.BeginRenameCommand.Execute(undefined)
    row.EditTitle = '  New title  '
    row.RenameKeyCommand.Execute({ Key: Key.Return })
    expect(row.IsEditing).toBe(false)
    expect(row.Title).toBe('New title')
    expect(calls.renamed).toEqual([{ id: 's1', title: 'New title' }])
})

test('Escape cancels rename — no callback, title unchanged', () => {
    const { row, calls } = makeRow()
    row.BeginRenameCommand.Execute(undefined)
    row.EditTitle = 'Discarded'
    row.RenameKeyCommand.Execute({ Key: Key.Escape })
    expect(row.IsEditing).toBe(false)
    expect(row.Title).toBe('Old title')
    expect(calls.renamed).toEqual([])
})

test('committing an empty or unchanged title is a no-op callback', () => {
    const { row, calls } = makeRow()
    row.BeginRenameCommand.Execute(undefined)
    row.EditTitle = '   '
    row.RenameKeyCommand.Execute({ Key: Key.Return })
    expect(row.IsEditing).toBe(false)
    expect(row.Title).toBe('Old title')
    expect(calls.renamed).toEqual([])
})
