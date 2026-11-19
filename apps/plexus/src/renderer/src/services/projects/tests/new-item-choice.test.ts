import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { NewItemChoice } from '@pragmatic-tech-ai/plexus-core/renderer/projects/new-item-choice.js'

test('NewItemChoice exposes its label and runs its command', () => {
    let ran = false
    const choice = new NewItemChoice('Architecture Board', new RelayCommand(() => { ran = true }))
    expect(choice.Label).toBe('Architecture Board')
    choice.Command!.Execute(undefined)
    expect(ran).toBe(true)
})
