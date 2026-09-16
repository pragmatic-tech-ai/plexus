import { test, expect } from 'vitest'
import { ProjectNode } from '../project.js'
import { resolveDropTargetPath, planNodeMoves } from '../node-move.js'

const folder = (path: string) => new ProjectNode(path.split('/').pop() ?? path, path, 'folder')
const file = (path: string) => new ProjectNode(path.split('/').pop() ?? path, path, 'todl')

test('resolveDropTargetPath: folder → own path, file → parent, undefined → root', () => {
    expect(resolveDropTargetPath(folder('src/lib'))).toBe('src/lib')
    expect(resolveDropTargetPath(file('src/a.todl'))).toBe('src')
    expect(resolveDropTargetPath(file('a.todl'))).toBe('')
    expect(resolveDropTargetPath(undefined)).toBe('')
})

test('plans a straightforward move into a subfolder', () => {
    const plan = planNodeMoves([file('a.todl')], 'src')
    expect(plan.moves).toEqual([{ from: 'a.todl', to: 'src/a.todl', name: 'a.todl' }])
    expect(plan.rejects).toEqual([])
})

test('skips a node already in the destination folder', () => {
    const plan = planNodeMoves([file('src/a.todl')], 'src')
    expect(plan.moves).toEqual([])
    expect(plan.rejects).toEqual([])
})

test('rejects moving a folder into itself or a descendant', () => {
    expect(planNodeMoves([folder('src')], 'src').rejects.length).toBe(1)
    expect(planNodeMoves([folder('src')], 'src/lib').rejects.length).toBe(1)
    expect(planNodeMoves([folder('src')], 'src/lib').moves).toEqual([])
})

test('when a folder and its child are both selected, only the folder moves', () => {
    const plan = planNodeMoves([folder('src'), file('src/a.todl')], 'dst')
    expect(plan.moves).toEqual([{ from: 'src', to: 'dst/src', name: 'src' }])
})

test('cross-project plan keeps ancestor-filter but skips same-project guards', () => {
    // Into a DIFFERENT project's 'src' folder: not "already there", not "into self".
    const plan = planNodeMoves([folder('src'), file('src/a.todl')], 'src', false)
    expect(plan.moves).toEqual([{ from: 'src', to: 'src/src', name: 'src' }])
    expect(plan.rejects).toEqual([])
})
