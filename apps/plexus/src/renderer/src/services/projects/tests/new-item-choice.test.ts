import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { NewItemChoice } from '../new-item-choice.js'

test('NewItemChoice exposes its label and runs its command', () => {
    let ran = false
    const choice = new NewItemChoice('Architecture Diagram', new RelayCommand(() => { ran = true }))
    expect(choice.Label).toBe('Architecture Diagram')
    choice.Command!.Execute(undefined)
    expect(ran).toBe(true)
})
