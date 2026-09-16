import { describe, expect, test, vi } from 'vitest'
import { FileChangeKind, type FileChangeEvent } from '../../../../../shared/file-watch-api.js'
import { EditorReloadService } from '../editor-reload-service.js'
import { FileWatchService } from '../file-watch-service.js'
import { CodeEditorService } from '../../../modules/code-editor/code-editor-service.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'

function fakeDoc(dirty: boolean) {
  return { Id: 'x.todl', IsDirty: dirty, Reload: vi.fn(async () => {}) }
}

function harness(opts: { doc?: ReturnType<typeof fakeDoc>; confirm?: boolean }) {
  let changedCb: ((e: FileChangeEvent) => void) | undefined
  const fileWatch = { Subscribe: (cb: (e: FileChangeEvent) => void) => { changedCb = cb; return () => {} } }
  const codeEditor = { FindOpenByOsPath: vi.fn(() => opts.doc) }
  const explorer = { FindOpenCodeDocByOsPath: vi.fn(() => undefined) }
  const dialogs = { Show: vi.fn(async () => opts.confirm), Close: vi.fn() }
  const provider = {
    getRequired: (key: unknown) => {
      if (key === FileWatchService.Key) return fileWatch
      if (key === CodeEditorService.Key) return codeEditor
      if (key === ProjectExplorerService.Key) return explorer
      if (key === DialogService.Key) return dialogs
      throw new Error('unexpected key')
    },
  }
  const svc = new EditorReloadService(provider as never)
  return { svc, fire: (e: FileChangeEvent) => changedCb?.(e), dialogs }
}

describe('EditorReloadService', () => {
  test('clean buffer reloads silently, no dialog', async () => {
    const doc = fakeDoc(false)
    const h = harness({ doc })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Changed })
    await Promise.resolve(); await Promise.resolve()
    expect(doc.Reload).toHaveBeenCalledOnce()
    expect(h.dialogs.Show).not.toHaveBeenCalled()
  })

  test('dirty buffer prompts; confirm reloads', async () => {
    const doc = fakeDoc(true)
    const h = harness({ doc, confirm: true })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Changed })
    await Promise.resolve(); await Promise.resolve()
    expect(h.dialogs.Show).toHaveBeenCalledOnce()
    expect(doc.Reload).toHaveBeenCalledOnce()
  })

  test('dirty buffer prompts; cancel does NOT reload', async () => {
    const doc = fakeDoc(true)
    const h = harness({ doc, confirm: false })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Changed })
    await Promise.resolve(); await Promise.resolve()
    expect(h.dialogs.Show).toHaveBeenCalledOnce()
    expect(doc.Reload).not.toHaveBeenCalled()
  })

  test('Removed kind is ignored', async () => {
    const doc = fakeDoc(false)
    const h = harness({ doc })
    h.fire({ path: 'C:/p/x.todl', kind: FileChangeKind.Removed })
    await Promise.resolve()
    expect(doc.Reload).not.toHaveBeenCalled()
  })

  test('no matching open doc is a no-op', async () => {
    const h = harness({ doc: undefined })
    h.fire({ path: 'C:/p/none.todl', kind: FileChangeKind.Changed })
    await Promise.resolve()
    expect(h.dialogs.Show).not.toHaveBeenCalled()
  })
})
