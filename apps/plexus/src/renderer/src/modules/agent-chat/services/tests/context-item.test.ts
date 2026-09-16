import { test, expect } from 'vitest'
import { ContextItemVM } from '../context-item.js'

test('fromPath on a file exposes the basename + its parent dir', () => {
    let removed: ContextItemVM | undefined
    const vm = ContextItemVM.fromPath('C:/a/b/file.ts', false, (v) => { removed = v })
    expect(vm.Name).toBe('file.ts')
    expect(vm.Dir).toBe('C:/a/b')
    expect(vm.IsFolder).toBe(false)
    expect(vm.Path).toBe('C:/a/b/file.ts')
    vm.RemoveCommand.Execute()
    expect(removed).toBe(vm)
})

test('fromPath on a folder uses the folder itself as Dir', () => {
    const vm = ContextItemVM.fromPath('C:/a/b', true, () => {})
    expect(vm.Name).toBe('b')
    expect(vm.Dir).toBe('C:/a/b')
    expect(vm.IsFolder).toBe(true)
})

test('fromPath handles backslash paths', () => {
    const vm = ContextItemVM.fromPath('C:\\x\\y\\z.md', false, () => {})
    expect(vm.Name).toBe('z.md')
    expect(vm.Dir).toBe('C:\\x\\y')
})
