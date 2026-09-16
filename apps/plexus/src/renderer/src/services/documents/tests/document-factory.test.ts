import { test, expect } from 'vitest'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { isRelocatable, type IDocumentFactory, type IRelocatableDocumentFactory } from '../document-factory.js'

const doc = (): IDocument => ({ Id: 'x', Title: 'x', IsDirty: false, Save() {} })

test('isRelocatable is true only when relocateOpenFile is present', () => {
    const plain: IDocumentFactory = {
        openFile: async (_s: IStorage, path: string) => { void path; return doc() },
        saveFile: async () => {},
        newFile: async (_s: IStorage, name: string) => name,
    }
    const relocatable: IDocumentFactory & IRelocatableDocumentFactory = {
        ...plain,
        relocateOpenFile: () => {},
    }
    expect(isRelocatable(plain)).toBe(false)
    expect(isRelocatable(relocatable)).toBe(true)
})
