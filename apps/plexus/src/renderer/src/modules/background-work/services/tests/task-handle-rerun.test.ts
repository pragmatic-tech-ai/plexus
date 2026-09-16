import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { TaskHandle } from '../task-handle.js'

test('RerunCommand and HasRerun reflect a set command', () => {
    const h = new TaskHandle({ id: 't1', title: 'Run', kind: 'inline' })
    expect(h.HasRerun).toBe(false)
    expect(h.RerunCommand).toBeUndefined()
    let ran = false
    h.RerunCommand = new RelayCommand(() => { ran = true })
    expect(h.HasRerun).toBe(true)
    h.RerunCommand!.Execute(undefined)
    expect(ran).toBe(true)
})
